"""Forecast hourly load with a trained model, then split it into base and variable load.

A model trained with horizon H only uses load lags >= H, so it predicts H hours
at once. Longer windows are forecast recursively: each block's predictions are
written back into the series and feed the lags of the next block.

Base load is the daily minimum of the hourly forecast (the load the grid must
always serve that day); variable load is the forecast minus that day's base load.
"""

from __future__ import annotations

import threading
from collections import OrderedDict
from datetime import date, datetime, timedelta
from typing import Any

import numpy as np
import pandas as pd
from pydantic import BaseModel, Field

from gridml import artifacts, db, jsonutil, scenario
from gridml.config import LOCAL_TZ
from gridml.features import FeatureConfig, build_features
from gridml.ingest.weather import WEATHER_COLUMNS
from gridml.metrics import regression_metrics
from gridml.scenario import Scenario
from gridml.warehouse import Dataset, load_dataset, weather_climatology

CONTEXT_HOURS = 400  # history each block needs for lags up to 336 h and rolling windows
MAX_GAP = timedelta(days=14)  # longest stretch we bridge recursively before the start


class ForecastRequest(BaseModel):
    model_id: str
    # Local (America/Toronto) start. A date means midnight. None = next hour without data.
    start: datetime | date | None = None
    hours: int = Field(48, ge=1, le=24 * 14)
    scenario: Scenario | None = None
    save: bool = True


_cache: OrderedDict[str, dict[str, Any]] = OrderedDict()
_cache_lock = threading.Lock()


def load_bundle(model_id: str) -> dict[str, Any]:
    with _cache_lock:
        if model_id in _cache:
            _cache.move_to_end(model_id)
            return _cache[model_id]
    rows = db.execute("select artifact_uri from grid.models where id = %s", (model_id,))
    if not rows:
        raise LookupError(f"model {model_id} not found")
    bundle: dict[str, Any] = artifacts.load(rows[0]["artifact_uri"])
    with _cache_lock:
        _cache[model_id] = bundle
        while len(_cache) > 3:
            _cache.popitem(last=False)
    return bundle


def forget_bundle(model_id: str) -> None:
    with _cache_lock:
        _cache.pop(model_id, None)


def to_utc(start: datetime | date) -> pd.Timestamp:
    ts = pd.Timestamp(start)
    ts = ts.tz_localize(LOCAL_TZ) if ts.tzinfo is None else ts
    return ts.tz_convert("UTC").floor("h")


def fill_weather(frame: pd.DataFrame, climatology: pd.DataFrame | None) -> pd.Series:
    """Fill missing weather with climatology; returns a per-hour weather-source label."""
    missing = frame["temperature_c"].isna()
    source = pd.Series(np.where(missing, "climatology", "weather"), index=frame.index)
    if missing.any() and climatology is not None and not climatology.empty:
        clim = climatology.set_index(["doy", "hour"])
        keys = pd.MultiIndex.from_arrays([frame.index.day_of_year, frame.index.hour])
        filled = clim.reindex(keys)
        filled.index = frame.index
        for col in WEATHER_COLUMNS:
            frame[col] = frame[col].fillna(filled[col])
    return source


def forecast_with_bundle(
    bundle: dict[str, Any],
    dataset: Dataset,
    start: pd.Timestamp,
    hours: int,
    climatology: pd.DataFrame | None = None,
    scen: Scenario | None = None,
) -> dict[str, Any]:
    cfg = FeatureConfig(
        horizon_hours=bundle["feature_config"]["horizon_hours"],
        groups=tuple(bundle["feature_config"]["groups"]),
    )
    model = bundle["model"]
    columns: list[str] = bundle["feature_columns"]
    end = start + pd.Timedelta(hours=hours)
    frame = dataset.frame.copy()
    window = pd.date_range(start, end, freq="h", tz="UTC", inclusive="left")
    actual = frame["load_mw"].reindex(window)

    weather_source = fill_weather(frame, climatology)
    frame.loc[frame.index >= start, "load_mw"] = np.nan
    last_obs = frame["load_mw"].loc[: start - pd.Timedelta(hours=1)].last_valid_index()
    if last_obs is None:
        raise ValueError("no observed load before the forecast start; run ingestion first")
    # Bridge any gap between the last observed hour and the requested start.
    cursor = min(start, last_obs + pd.Timedelta(hours=1))
    gap_hours = int((start - cursor) / pd.Timedelta(hours=1))

    while cursor < end:
        block_end = min(cursor + pd.Timedelta(hours=cfg.horizon_hours), end)
        ctx = frame.loc[
            cursor - pd.Timedelta(hours=CONTEXT_HOURS) : block_end - pd.Timedelta(hours=1)
        ]
        X = build_features(ctx, dataset.holidays, cfg).loc[cursor:]
        X = X.loc[X.index < block_end].reindex(columns=columns)
        frame.loc[X.index, "load_mw"] = model.predict(X)
        cursor = block_end

    pred = frame["load_mw"].reindex(window)
    local = window.tz_convert(LOCAL_TZ)
    q = bundle.get("residual_quantiles") or {}
    lower = pred + np.take(q.get("0.1", [0.0] * 24), local.hour)
    upper = pred + np.take(q.get("0.9", [0.0] * 24), local.hour)

    days = pd.Series(local.date, index=window)
    baseload = pred.groupby(days).transform("min")
    variable = pred - baseload
    weather = frame.reindex(window)
    scen_df = (
        scenario.apply(pred, weather, dataset.holidays, scen) if scen and scen.active else None
    )

    def num(v: Any) -> float | None:
        return None if v is None or not np.isfinite(v) else round(float(v), 2)

    points = []
    for i, ts in enumerate(window):
        p: dict[str, Any] = {
            "ts": ts.isoformat(),
            "local_time": local[i].isoformat(),
            "predicted_mw": num(pred.iloc[i]),
            "lower_mw": num(lower.iloc[i]),
            "upper_mw": num(upper.iloc[i]),
            "actual_mw": num(actual.iloc[i]),
            "baseload_mw": num(baseload.iloc[i]),
            "variable_mw": num(variable.iloc[i]),
            "temperature_c": num(weather["temperature_c"].iloc[i]),
            "weather": weather_source.reindex(window).iloc[i],
        }
        if scen_df is not None:
            p |= {k: num(scen_df[k].iloc[i]) for k in scen_df.columns}
        points.append(p)

    daily = []
    frame_out = pd.DataFrame({"pred": pred, "actual": actual, "day": days, "hour": local.hour})
    if scen_df is not None:
        frame_out["net"] = scen_df["net_load_mw"]
    for day, g in frame_out.groupby("day"):
        peak_idx = g["pred"].idxmax()
        row: dict[str, Any] = {
            "date": day.isoformat(),
            "hours": len(g),
            "peak_mw": num(g["pred"].max()),
            "peak_hour": int(g.loc[peak_idx, "hour"]),
            "baseload_mw": num(g["pred"].min()),
            "mean_mw": num(g["pred"].mean()),
            "energy_mwh": num(g["pred"].sum()),
            "variable_energy_mwh": num((g["pred"] - g["pred"].min()).sum()),
            "actual_peak_mw": num(g["actual"].max()) if g["actual"].notna().all() else None,
            "actual_baseload_mw": num(g["actual"].min()) if g["actual"].notna().all() else None,
        }
        if "net" in g:
            row |= {"net_peak_mw": num(g["net"].max()), "net_baseload_mw": num(g["net"].min())}
        daily.append(row)

    known = actual.notna()
    notes = []
    if gap_hours:
        notes.append(
            f"Latest observed load is {gap_hours} h before the start; those hours were "
            "forecast first and fed the lags."
        )
    if hours > cfg.horizon_hours:
        notes.append(
            f"Model horizon is {cfg.horizon_hours} h; hours beyond it are forecast "
            "recursively, so uncertainty grows with lead time."
        )
    clim_hours = int((weather_source.reindex(window) == "climatology").sum())
    if clim_hours:
        notes.append(
            f"{clim_hours} h had no weather forecast and used climatology (average "
            "weather for that day and hour)."
        )
    return {
        "start": start.isoformat(),
        "end": end.isoformat(),
        "hours": hours,
        "target_zone": bundle["target_zone"],
        "horizon_hours": cfg.horizon_hours,
        "points": points,
        "daily": daily,
        "accuracy": regression_metrics(actual[known], pred[known]) if known.any() else None,
        "scenario": scen.model_dump() if scen else None,
        "notes": notes,
    }


def run_forecast(req: ForecastRequest) -> dict[str, Any]:
    bundle = load_bundle(req.model_id)
    zone = bundle["target_zone"]
    start = to_utc(req.start) if req.start is not None else None
    rows = db.execute(
        "select max(ts_utc) as ts from grid.ieso_zonal_demand where zone = %s "
        "and (%s::timestamptz is null or ts_utc < %s::timestamptz)",
        (zone, start, start),
    )
    if not rows or rows[0]["ts"] is None:
        raise ValueError("no demand data before the start; run ingestion first")
    first_unknown = pd.Timestamp(rows[0]["ts"]).tz_convert("UTC") + pd.Timedelta(hours=1)
    start = start if start is not None else first_unknown
    if start - first_unknown > MAX_GAP:
        raise ValueError(
            f"latest demand data ends {first_unknown:%Y-%m-%d %H:%M} UTC, more than "
            f"{MAX_GAP.days} days before the start; ingest newer data or pick an earlier start"
        )
    end = start + pd.Timedelta(hours=req.hours)
    dataset = load_dataset(zone, min(start, first_unknown) - timedelta(days=30), end)
    result = forecast_with_bundle(
        bundle, dataset, start, req.hours, weather_climatology(zone), req.scenario
    )
    result["model_id"] = req.model_id
    if req.save:
        summary = {"daily": result["daily"], "accuracy": result["accuracy"]}
        rows = db.execute(
            "insert into grid.forecasts (model_id, start_ts, hours, scenario, summary) "
            "values (%s, %s, %s, %s::jsonb, %s::jsonb) returning id",
            (
                req.model_id,
                start.to_pydatetime(),
                req.hours,
                jsonutil.dumps(req.scenario.model_dump() if req.scenario else {}),
                jsonutil.dumps(summary),
            ),
        )
        result["id"] = str(rows[0]["id"])
    return result
