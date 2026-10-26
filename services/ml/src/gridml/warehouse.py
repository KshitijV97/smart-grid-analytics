"""Read model-ready hourly frames from the warehouse."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date

import numpy as np
import pandas as pd

from gridml import db
from gridml.config import ZONE_WEATHER_WEIGHTS
from gridml.ingest.weather import WEATHER_COLUMNS

FRAME_COLUMNS = ["load_mw", *WEATHER_COLUMNS, "wind_gen_mw", "solar_gen_mw"]
# Observed weather wins over forecast weather for the same hour.
SOURCE_RANK = {"era5": 0, "forecast": 1}


@dataclass
class Dataset:
    frame: pd.DataFrame  # hourly UTC index, FRAME_COLUMNS
    holidays: set[date]


def zones() -> list[str]:
    return list(ZONE_WEATHER_WEIGHTS)


def blend_weather(weather: pd.DataFrame, weights: dict[str, float]) -> pd.DataFrame:
    """Weighted average across locations, preferring observed over forecast rows."""
    if weather.empty:
        return pd.DataFrame(columns=WEATHER_COLUMNS)
    w = weather.copy()
    w["rank"] = w["source"].map(SOURCE_RANK)
    w = w.sort_values("rank").drop_duplicates(["ts_utc", "location"], keep="first")
    w["weight"] = w["location"].map(weights)
    blended = {}
    for col in WEATHER_COLUMNS:
        vals = pd.to_numeric(w[col], errors="coerce")
        wt = w["weight"].where(vals.notna(), 0.0)
        num = (vals.fillna(0.0) * wt).groupby(w["ts_utc"]).sum()
        den = wt.groupby(w["ts_utc"]).sum()
        blended[col] = num / den.replace(0.0, np.nan)
    return pd.DataFrame(blended)


def load_dataset(zone: str, start: pd.Timestamp, end: pd.Timestamp) -> Dataset:
    """Hourly frame for [start, end) in UTC."""
    if zone not in ZONE_WEATHER_WEIGHTS:
        raise ValueError(f"unknown zone {zone!r}; choose from {zones()}")
    weights = ZONE_WEATHER_WEIGHTS[zone]
    idx = pd.date_range(start, end, freq="h", tz="UTC", inclusive="left")
    rng = (start.to_pydatetime(), end.to_pydatetime())

    load = db.fetch_df(
        "select ts_utc, demand_mw from grid.ieso_zonal_demand "
        "where zone = %s and ts_utc >= %s and ts_utc < %s",
        (zone, *rng),
    )
    weather = db.fetch_df(
        f"select ts_utc, location, source, {', '.join(WEATHER_COLUMNS)} from grid.weather_hourly "
        "where location = any(%s) and source in ('era5', 'forecast') "
        "and ts_utc >= %s and ts_utc < %s",
        (list(weights), *rng),
    )
    fuel = db.fetch_df(
        "select ts_utc, fuel, output_mw from grid.ieso_generation_fuel "
        "where fuel in ('WIND', 'SOLAR') and ts_utc >= %s and ts_utc < %s",
        rng,
    )
    hol = db.fetch_df("select day from grid.holidays where region = 'CA-ON'")

    frame = pd.DataFrame(index=idx)
    if not load.empty:
        frame["load_mw"] = load.set_index(pd.to_datetime(load["ts_utc"], utc=True))["demand_mw"]
    else:
        frame["load_mw"] = np.nan
    if not weather.empty:
        weather["ts_utc"] = pd.to_datetime(weather["ts_utc"], utc=True)
    frame = frame.join(blend_weather(weather, weights))
    if not fuel.empty:
        fuel["ts_utc"] = pd.to_datetime(fuel["ts_utc"], utc=True)
        piv = fuel.pivot_table(index="ts_utc", columns="fuel", values="output_mw")
        frame["wind_gen_mw"] = piv.get("WIND")
        frame["solar_gen_mw"] = piv.get("SOLAR")
    for col in FRAME_COLUMNS:
        if col not in frame.columns:
            frame[col] = np.nan
    frame = frame[FRAME_COLUMNS].astype(float)
    # Fill short gaps in exogenous series (DST glitches, late provider updates).
    exog = [c for c in FRAME_COLUMNS if c != "load_mw"]
    frame[exog] = frame[exog].interpolate(limit=6, limit_area="inside")
    holidays = set(pd.to_datetime(hol["day"]).dt.date) if not hol.empty else set()
    return Dataset(frame=frame, holidays=holidays)


def weather_climatology(zone: str) -> pd.DataFrame:
    """Mean observed weather by (day-of-year, UTC hour); fills hours past the forecast range."""
    weights = ZONE_WEATHER_WEIGHTS[zone]
    df = db.fetch_df(
        f"select extract(doy from ts_utc)::int as doy, extract(hour from ts_utc)::int as hour, "
        f"location, {', '.join(f'avg({c}) as {c}' for c in WEATHER_COLUMNS)} "
        "from grid.weather_hourly where source = 'era5' and location = any(%s) "
        "group by 1, 2, 3",
        (list(weights),),
    )
    if df.empty:
        return pd.DataFrame(columns=["doy", "hour", *WEATHER_COLUMNS])
    weight = df["location"].map(weights)
    keys = [df["doy"], df["hour"]]
    out = pd.DataFrame(
        {
            c: (df[c].astype(float) * weight).groupby(keys).sum()
            / weight.where(df[c].notna(), 0.0).groupby(keys).sum()
            for c in WEATHER_COLUMNS
        }
    )
    return out.rename_axis(["doy", "hour"]).reset_index()
