"""Forecast accuracy metrics, overall and broken down for critical analysis."""

from __future__ import annotations

from collections.abc import Iterable
from datetime import date
from typing import Any

import numpy as np
import pandas as pd

from gridml.config import LOCAL_TZ

SEASONS = {
    12: "winter",
    1: "winter",
    2: "winter",
    3: "spring",
    4: "spring",
    5: "spring",
    6: "summer",
    7: "summer",
    8: "summer",
    9: "fall",
    10: "fall",
    11: "fall",
}


def regression_metrics(actual: Iterable[float], predicted: Iterable[float]) -> dict[str, float]:
    y = np.asarray(list(actual), dtype=float)
    p = np.asarray(list(predicted), dtype=float)
    mask = np.isfinite(y) & np.isfinite(p)
    y, p = y[mask], p[mask]
    if len(y) == 0:
        nan = float("nan")
        return {"n": 0, "mae": nan, "rmse": nan, "mape": nan, "r2": nan, "bias": nan}
    err = p - y
    ss_res = float(np.sum(err**2))
    ss_tot = float(np.sum((y - y.mean()) ** 2))
    nonzero = np.abs(y) > 1e-9
    return {
        "n": len(y),
        "mae": float(np.mean(np.abs(err))),
        "rmse": float(np.sqrt(np.mean(err**2))),
        "mape": float(np.mean(np.abs(err[nonzero] / y[nonzero])) * 100),
        "r2": 1 - ss_res / ss_tot if ss_tot > 0 else float("nan"),
        "bias": float(np.mean(err)),
    }


def breakdown(
    ts_utc: pd.Series, actual: pd.Series, predicted: pd.Series, holidays: set[date]
) -> dict[str, Any]:
    """Metrics overall and by season, on/off-peak, holiday, hour of day, plus daily
    baseload (daily minimum) and daily peak."""
    local = pd.DatetimeIndex(pd.to_datetime(ts_utc, utc=True)).tz_convert(LOCAL_TZ)
    df = pd.DataFrame({"actual": actual.to_numpy(), "predicted": predicted.to_numpy()}, index=local)
    df["day"] = local.date
    df["season"] = [SEASONS[m] for m in local.month]
    df["holiday"] = df["day"].isin(holidays)
    workday = (local.day_of_week < 5) & ~df["holiday"].to_numpy()
    # IESO on-peak: 07:00-23:00 on workdays.
    df["on_peak"] = workday & (local.hour >= 7) & (local.hour < 23)

    def m(sub: pd.DataFrame) -> dict[str, float]:
        return regression_metrics(sub["actual"], sub["predicted"])

    daily = df.groupby("day").agg(
        actual_min=("actual", "min"),
        predicted_min=("predicted", "min"),
        actual_max=("actual", "max"),
        predicted_max=("predicted", "max"),
        hours=("actual", "size"),
    )
    daily = daily[daily["hours"] >= 23]  # whole days only (DST days have 23/25 h)
    return {
        "overall": m(df),
        "by_season": {s: m(g) for s, g in df.groupby("season")},
        "on_peak": m(df[df["on_peak"]]),
        "off_peak": m(df[~df["on_peak"]]),
        "holidays": m(df[df["holiday"]]),
        "non_holidays": m(df[~df["holiday"]]),
        "by_hour_mae": [
            float(np.mean(np.abs(g["predicted"] - g["actual"])))
            for _, g in df.groupby(df.index.hour)
        ],
        "daily_baseload": regression_metrics(daily["actual_min"], daily["predicted_min"]),
        "daily_peak": regression_metrics(daily["actual_max"], daily["predicted_max"]),
    }
