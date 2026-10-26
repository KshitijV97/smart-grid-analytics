"""Runtime settings, read from environment variables."""

from __future__ import annotations

from dataclasses import dataclass
from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict

LOCAL_TZ = "America/Toronto"


@dataclass(frozen=True)
class Location:
    name: str
    latitude: float
    longitude: float


# Weather points. Ottawa drives the Ottawa zone; the Ontario target uses a
# population-weighted blend of the larger load centres.
LOCATIONS: dict[str, Location] = {
    "ottawa": Location("ottawa", 45.4215, -75.6972),
    "toronto": Location("toronto", 43.6532, -79.3832),
    "london": Location("london", 42.9849, -81.2453),
    "sudbury": Location("sudbury", 46.4917, -80.9930),
}

ZONE_WEATHER_WEIGHTS: dict[str, dict[str, float]] = {
    "Ottawa": {"ottawa": 1.0},
    "Ontario": {"toronto": 0.6, "ottawa": 0.2, "london": 0.12, "sudbury": 0.08},
}

# ECCC station used for observed Ottawa weather (OTTAWA INTL A, climate ID 6106001).
ECCC_OTTAWA_STATION_ID = 49568


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "postgresql://grid:grid@localhost:5432/grid"
    # "file:///data/models" for local disk, "gs://bucket/prefix" for Google Cloud Storage.
    artifact_store: str = "file:///tmp/gridml-models"
    # Earliest hour to backfill. Training defaults start in 2020; one extra month
    # gives the lag features (up to 168 h) a warm-up period.
    backfill_start: str = "2019-12-01"
    http_timeout_seconds: float = 120.0
    # Contact string sent as User-Agent to the public data providers.
    user_agent: str = "smart-grid-analytics (ELG5255 course project)"


@lru_cache
def get_settings() -> Settings:
    return Settings()
