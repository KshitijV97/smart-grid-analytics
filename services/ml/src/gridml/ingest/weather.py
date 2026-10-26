"""Weather: Open-Meteo (historical reanalysis + forecast) and ECCC station data."""

from __future__ import annotations

import io
from datetime import date
from typing import Any

import pandas as pd

from gridml.config import Location
from gridml.ingest.http import get

ARCHIVE_URL = "https://archive-api.open-meteo.com/v1/archive"
FORECAST_URL = "https://api.open-meteo.com/v1/forecast"
ECCC_URL = "https://climate.weather.gc.ca/climate_data/bulk_data_e.html"

# Open-Meteo variable -> warehouse column.
OPEN_METEO_VARS: dict[str, str] = {
    "temperature_2m": "temperature_c",
    "dew_point_2m": "dew_point_c",
    "relative_humidity_2m": "relative_humidity_pct",
    "apparent_temperature": "apparent_temperature_c",
    "precipitation": "precipitation_mm",
    "snowfall": "snowfall_cm",
    "cloud_cover": "cloud_cover_pct",
    "wind_speed_10m": "wind_speed_10m_kmh",
    "wind_speed_100m": "wind_speed_100m_kmh",
    "shortwave_radiation": "shortwave_radiation_wm2",
    "direct_radiation": "direct_radiation_wm2",
    "diffuse_radiation": "diffuse_radiation_wm2",
}
WEATHER_COLUMNS = list(OPEN_METEO_VARS.values())


def parse_open_meteo(payload: dict[str, Any], location: str, source: str) -> pd.DataFrame:
    hourly = payload.get("hourly") or {}
    if not hourly.get("time"):
        return pd.DataFrame(columns=["ts_utc", "location", "source", *WEATHER_COLUMNS])
    df = pd.DataFrame({"ts_utc": pd.to_datetime(hourly["time"], utc=True)})
    for var, col in OPEN_METEO_VARS.items():
        df[col] = pd.to_numeric(pd.Series(hourly.get(var, [None] * len(df))), errors="coerce")
    df["location"] = location
    df["source"] = source
    # Drop hours where the provider has not filled anything in yet.
    df = df.dropna(subset=WEATHER_COLUMNS, how="all")
    return df[["ts_utc", "location", "source", *WEATHER_COLUMNS]]


def _common_params(loc: Location) -> dict[str, Any]:
    return {
        "latitude": loc.latitude,
        "longitude": loc.longitude,
        "hourly": ",".join(OPEN_METEO_VARS),
        "timezone": "GMT",
        "wind_speed_unit": "kmh",
    }


def fetch_archive(loc: Location, start: date, end: date) -> pd.DataFrame:
    params = _common_params(loc) | {"start_date": start.isoformat(), "end_date": end.isoformat()}
    return parse_open_meteo(get(ARCHIVE_URL, params).json(), loc.name, "era5")


def fetch_forecast(loc: Location, past_days: int = 7, forecast_days: int = 16) -> pd.DataFrame:
    params = _common_params(loc) | {"past_days": past_days, "forecast_days": forecast_days}
    return parse_open_meteo(get(FORECAST_URL, params).json(), loc.name, "forecast")


_ECCC_COLUMNS = {
    "Temp (°C)": "temperature_c",
    "Dew Point Temp (°C)": "dew_point_c",
    "Rel Hum (%)": "relative_humidity_pct",
    "Precip. Amount (mm)": "precipitation_mm",
    "Wind Spd (km/h)": "wind_speed_10m_kmh",
}


def parse_eccc_csv(text: str, location: str) -> pd.DataFrame:
    """Parse an ECCC hourly bulk CSV. Times are Local Standard Time (UTC-5)."""
    df = pd.read_csv(io.StringIO(text.lstrip("﻿")))
    ts_col = next(c for c in df.columns if c.startswith("Date/Time"))
    out = pd.DataFrame(
        {"ts_utc": (pd.to_datetime(df[ts_col]) + pd.Timedelta(hours=5)).dt.tz_localize("UTC")}
    )
    for src, col in _ECCC_COLUMNS.items():
        out[col] = pd.to_numeric(df[src], errors="coerce") if src in df.columns else None
    for col in WEATHER_COLUMNS:
        if col not in out.columns:
            out[col] = None
    out["location"] = location
    out["source"] = "eccc"
    out = out.dropna(subset=list(_ECCC_COLUMNS.values()), how="all")
    return out[["ts_utc", "location", "source", *WEATHER_COLUMNS]]


def fetch_eccc_month(station_id: int, year: int, month: int, location: str) -> pd.DataFrame:
    params = {
        "format": "csv",
        "stationID": station_id,
        "Year": year,
        "Month": month,
        "Day": 1,
        "timeframe": 1,
        "submit": "Download Data",
    }
    return parse_eccc_csv(get(ECCC_URL, params).text, location)
