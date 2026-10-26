"""Feature engineering on an hourly UTC frame.

Input frame (hourly, continuous, tz-aware UTC index) columns:
    load_mw                         target zone demand (NaN where unknown / to predict)
    <weather columns>               blended weather for the zone (see weather.WEATHER_COLUMNS)
    wind_gen_mw, solar_gen_mw       Ontario transmission-connected wind / solar output

Lagged quantities (load, IESO generation) are only used at lags >= horizon_hours,
so a model trained with horizon 24 can forecast a full day ahead without
seeing any load it would not have at forecast time. Weather at hour t is used
directly: in production it comes from the weather forecast, in back-tests from
observations (the usual "perfect weather forecast" assumption, stated in the report).
"""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass, field
from datetime import date

import numpy as np
import pandas as pd
import pvlib

from gridml.config import LOCAL_TZ

FEATURE_GROUPS: dict[str, str] = {
    "calendar": "Hour, weekday, month, holidays, daylight saving, COVID-19 lockdown flag",
    "weather": "Temperature, humidity, dew point, wind, precipitation, snow, cloud cover, "
    "heating/cooling degree-hours",
    "solar": "Sun elevation, irradiance, clear-sky index, estimated embedded-solar output",
    "renewables": "Ontario wind and solar generation (IESO), lagged",
    "load_lags": "Past demand: lags and rolling statistics",
}
DEFAULT_GROUPS = list(FEATURE_GROUPS)

LOAD_LAGS = (1, 2, 3, 24, 48, 72, 168, 336)
BALANCE_TEMP_C = 18.0
COVID_START = pd.Timestamp("2020-03-15", tz=LOCAL_TZ)
COVID_END = pd.Timestamp("2021-07-01", tz=LOCAL_TZ)

# Representative point for sun-position features (Ottawa; within ~1 h of the
# whole southern Ontario load centre, good enough for a smooth daylight signal).
SUN_LAT, SUN_LON = 45.42, -75.70


@dataclass(frozen=True)
class FeatureConfig:
    horizon_hours: int = 24
    groups: tuple[str, ...] = field(default_factory=lambda: tuple(DEFAULT_GROUPS))

    def __post_init__(self) -> None:
        unknown = set(self.groups) - set(FEATURE_GROUPS)
        if unknown:
            raise ValueError(f"unknown feature groups: {sorted(unknown)}")
        if self.horizon_hours < 1:
            raise ValueError("horizon_hours must be >= 1")

    @property
    def lags(self) -> list[int]:
        return [lag for lag in LOAD_LAGS if lag >= self.horizon_hours]


def ensure_hourly(frame: pd.DataFrame) -> pd.DataFrame:
    """Reindex to a continuous hourly UTC index (missing hours become NaN)."""
    if frame.index.tz is None:
        raise ValueError("frame index must be tz-aware UTC")
    idx = pd.date_range(frame.index.min(), frame.index.max(), freq="h", tz="UTC")
    return frame.reindex(idx)


def local_calendar(index: pd.DatetimeIndex, holidays: Iterable[date]) -> pd.DataFrame:
    local = index.tz_convert(LOCAL_TZ)
    hol = set(holidays)
    day = local.normalize().tz_localize(None)
    hol_days = pd.DatetimeIndex(sorted(pd.Timestamp(d) for d in hol))
    is_holiday = day.isin(hol_days)
    prev_hol = (day - pd.Timedelta(days=1)).isin(hol_days)
    next_hol = (day + pd.Timedelta(days=1)).isin(hol_days)
    dow = local.day_of_week
    is_weekend = dow >= 5
    out = pd.DataFrame(index=index)
    out["hour"] = local.hour
    out["dow"] = dow
    out["month"] = local.month
    out["day_of_year"] = local.day_of_year
    out["is_weekend"] = is_weekend.astype(int)
    out["is_holiday"] = is_holiday.astype(int)
    out["is_workday"] = (~is_weekend & ~is_holiday).astype(int)
    # A workday squeezed next to a holiday (e.g. the Friday after Thanksgiving week-end).
    out["near_holiday"] = ((prev_hol | next_hol) & ~is_holiday).astype(int)
    out["hour_sin"] = np.sin(2 * np.pi * local.hour / 24)
    out["hour_cos"] = np.cos(2 * np.pi * local.hour / 24)
    out["doy_sin"] = np.sin(2 * np.pi * local.day_of_year / 365.25)
    out["doy_cos"] = np.cos(2 * np.pi * local.day_of_year / 365.25)
    # Eastern Daylight Time is UTC-4, Eastern Standard Time is UTC-5.
    offset = local.tz_localize(None) - index.tz_localize(None)
    out["is_dst"] = (offset == pd.Timedelta(hours=-4)).astype(int)
    out["covid_lockdown"] = ((local >= COVID_START) & (local < COVID_END)).astype(int)
    return out


def sun_features(index: pd.DatetimeIndex, frame: pd.DataFrame) -> pd.DataFrame:
    pos = pvlib.solarposition.ephemeris(index, SUN_LAT, SUN_LON)
    zenith = pos["apparent_zenith"].to_numpy()
    clear = pvlib.clearsky.haurwitz(pd.Series(zenith, index=index))["ghi"].to_numpy()
    ghi = frame["shortwave_radiation_wm2"].to_numpy(dtype=float)
    temp = frame["temperature_c"].to_numpy(dtype=float)
    out = pd.DataFrame(index=index)
    out["sun_elevation"] = 90.0 - zenith
    out["clear_sky_ghi"] = clear
    with np.errstate(divide="ignore", invalid="ignore"):
        csi = np.where(clear > 20, ghi / clear, 0.0)
    out["clear_sky_index"] = np.clip(csi, 0, 1.5)
    out["ghi"] = ghi
    out["direct_radiation"] = frame["direct_radiation_wm2"].to_numpy(dtype=float)
    out["diffuse_radiation"] = frame["diffuse_radiation_wm2"].to_numpy(dtype=float)
    # Rooftop / distribution-connected solar is invisible to IESO and lowers the
    # measured demand at midday. A PVWatts-style capacity factor captures it.
    cell_temp = temp + ghi / 800.0 * 20.0
    out["embedded_pv_cf"] = np.clip(ghi / 1000.0 * (1 - 0.004 * (cell_temp - 25.0)), 0, 1)
    return out


def weather_features(frame: pd.DataFrame) -> pd.DataFrame:
    t = frame["temperature_c"]
    out = pd.DataFrame(index=frame.index)
    out["temperature"] = t
    out["apparent_temperature"] = frame["apparent_temperature_c"]
    out["dew_point"] = frame["dew_point_c"]
    out["humidity"] = frame["relative_humidity_pct"]
    out["precipitation"] = frame["precipitation_mm"]
    out["snowfall"] = frame["snowfall_cm"]
    out["cloud_cover"] = frame["cloud_cover_pct"]
    out["wind_speed_10m"] = frame["wind_speed_10m_kmh"]
    out["wind_speed_100m"] = frame["wind_speed_100m_kmh"]
    out["heating_degree_hours"] = (BALANCE_TEMP_C - t).clip(lower=0)
    out["cooling_degree_hours"] = (t - BALANCE_TEMP_C).clip(lower=0)
    # Buildings respond to the temperature of the last day, not just this hour.
    out["temperature_mean_24h"] = t.rolling(24, min_periods=12).mean()
    out["temperature_max_24h"] = t.rolling(24, min_periods=12).max()
    out["temperature_min_24h"] = t.rolling(24, min_periods=12).min()
    out["temperature_change_3h"] = t - t.shift(3)
    # Wind chill on heating load: cold and windy houses lose more heat.
    out["heating_x_wind"] = out["heating_degree_hours"] * frame["wind_speed_10m_kmh"]
    return out


def load_lag_features(load: pd.Series, cfg: FeatureConfig) -> pd.DataFrame:
    out = pd.DataFrame(index=load.index)
    for lag in cfg.lags:
        out[f"load_lag_{lag}h"] = load.shift(lag)
    base = load.shift(cfg.horizon_hours)
    out["load_mean_24h"] = base.rolling(24, min_periods=20).mean()
    out["load_min_24h"] = base.rolling(24, min_periods=20).min()
    out["load_max_24h"] = base.rolling(24, min_periods=20).max()
    out["load_mean_168h"] = base.rolling(168, min_periods=150).mean()
    return out


def renewable_features(frame: pd.DataFrame, cfg: FeatureConfig) -> pd.DataFrame:
    out = pd.DataFrame(index=frame.index)
    lag = max(cfg.horizon_hours, 1)
    for col in ("wind_gen_mw", "solar_gen_mw"):
        name = col.removesuffix("_mw")
        out[f"{name}_lag_{lag}h"] = frame[col].shift(lag)
        out[f"{name}_lag_168h"] = frame[col].shift(168)
    return out


def build_features(
    frame: pd.DataFrame, holidays: Iterable[date], cfg: FeatureConfig
) -> pd.DataFrame:
    """Return the feature matrix (same index as frame)."""
    frame = ensure_hourly(frame)
    parts: list[pd.DataFrame] = []
    if "calendar" in cfg.groups:
        parts.append(local_calendar(frame.index, holidays))
    if "weather" in cfg.groups:
        parts.append(weather_features(frame))
    if "solar" in cfg.groups:
        parts.append(sun_features(frame.index, frame))
    if "renewables" in cfg.groups:
        parts.append(renewable_features(frame, cfg))
    if "load_lags" in cfg.groups:
        parts.append(load_lag_features(frame["load_mw"], cfg))
    if not parts:
        raise ValueError("at least one feature group is required")
    return pd.concat(parts, axis=1)
