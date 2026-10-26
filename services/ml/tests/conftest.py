"""Shared fixtures. The synthetic dataset is for exercising code paths only; it is
not real data and must never be used for reported results."""

from __future__ import annotations

from datetime import date
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

from gridml.ingest.calendar import ontario_holidays
from gridml.warehouse import FRAME_COLUMNS, Dataset

FIXTURES = Path(__file__).parent / "fixtures"


def make_synthetic_dataset(
    start: str = "2022-12-01", end: str = "2025-03-01", seed: int = 0
) -> Dataset:
    rng = np.random.default_rng(seed)
    idx = pd.date_range(start, end, freq="h", tz="UTC", inclusive="left")
    local = idx.tz_convert("America/Toronto")
    doy = local.dayofyear.to_numpy()
    hour = local.hour.to_numpy()
    temp = 6 - 16 * np.cos(2 * np.pi * (doy - 20) / 365) + 5 * np.sin(2 * np.pi * (hour - 9) / 24)
    temp += rng.normal(0, 2, len(idx))
    daily = 1 + 0.18 * np.sin(2 * np.pi * (hour - 7) / 24)
    workday = (local.dayofweek < 5).astype(float)
    load = 1000 + 9 * np.clip(18 - temp, 0, None) + 14 * np.clip(temp - 20, 0, None)
    load = load * daily + 80 * workday + rng.normal(0, 15, len(idx))
    frame = pd.DataFrame(index=idx, columns=FRAME_COLUMNS, dtype=float)
    frame["load_mw"] = load
    frame["temperature_c"] = temp
    frame["apparent_temperature_c"] = temp - 2
    frame["dew_point_c"] = temp - 4
    frame["relative_humidity_pct"] = 70.0
    frame["precipitation_mm"] = 0.0
    frame["snowfall_cm"] = 0.0
    frame["cloud_cover_pct"] = 50.0
    frame["wind_speed_10m_kmh"] = 15 + rng.normal(0, 3, len(idx))
    frame["wind_speed_100m_kmh"] = 25 + rng.normal(0, 5, len(idx))
    sun = np.clip(np.sin(2 * np.pi * (hour - 6) / 24), 0, None)
    frame["shortwave_radiation_wm2"] = 600 * sun
    frame["direct_radiation_wm2"] = 400 * sun
    frame["diffuse_radiation_wm2"] = 200 * sun
    frame["wind_gen_mw"] = 2000 + rng.normal(0, 300, len(idx))
    frame["solar_gen_mw"] = 300 * sun
    hol = ontario_holidays(range(2022, 2026))
    return Dataset(frame=frame, holidays=set(hol["day"]))


@pytest.fixture(scope="session")
def synthetic() -> Dataset:
    return make_synthetic_dataset()


@pytest.fixture
def small_split() -> dict[str, date]:
    return {
        "train_start": date(2023, 1, 1),
        "train_end": date(2023, 12, 31),
        "val_start": date(2024, 1, 1),
        "val_end": date(2024, 6, 30),
        "test_start": date(2024, 7, 1),
        "test_end": date(2025, 2, 28),
    }
