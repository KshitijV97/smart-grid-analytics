"""Orchestrates source fetches, upserts them into the warehouse and logs each run."""

from __future__ import annotations

import logging
from collections.abc import Callable
from datetime import UTC, date, datetime, timedelta

import pandas as pd

from gridml import db
from gridml.config import ECCC_OTTAWA_STATION_ID, LOCATIONS, get_settings
from gridml.ingest import calendar, ieso, weather
from gridml.ingest.http import NotFoundError

log = logging.getLogger(__name__)

SOURCES = (
    "ieso_demand",
    "ieso_fuel",
    "weather_archive",
    "weather_forecast",
    "eccc",
    "holidays",
)

# Re-fetch this much recent history on incremental runs, because providers
# revise the latest days (IESO settles, ERA5 fills in with ~5 days delay).
REFRESH_WINDOW = timedelta(days=10)


def _last_ts(sql: str) -> datetime | None:
    rows = db.execute(sql)
    return rows[0]["ts"] if rows and rows[0]["ts"] else None


def _incremental_start(table_sql: str) -> date:
    last = _last_ts(table_sql)
    floor = date.fromisoformat(get_settings().backfill_start)
    if last is None:
        return floor
    return max(floor, (last - REFRESH_WINDOW).date())


def _years(start: date, end: date) -> range:
    return range(start.year, end.year + 1)


def _clip(df: pd.DataFrame, start: date, end: date) -> pd.DataFrame:
    lo = pd.Timestamp(start, tz="UTC")
    hi = pd.Timestamp(end + timedelta(days=1), tz="UTC")
    return df[(df["ts_utc"] >= lo) & (df["ts_utc"] < hi)]


def ingest_ieso_demand(start: date, end: date) -> int:
    total = 0
    for year in _years(start, end):
        try:
            df = _clip(ieso.fetch_zonal_demand(year), start, end)
        except NotFoundError:
            log.warning("IESO zonal demand: no file for %s", year)
            continue
        total += db.upsert_df(
            df, "grid.ieso_zonal_demand", ["ts_utc", "zone"], touch_ingested_at=True
        )
    return total


def ingest_ieso_fuel(start: date, end: date) -> int:
    total = 0
    for year in _years(start, end):
        try:
            df = _clip(ieso.fetch_fuel_output(year), start, end)
        except NotFoundError:
            log.warning("IESO fuel output: no file for %s", year)
            continue
        total += db.upsert_df(
            df, "grid.ieso_generation_fuel", ["ts_utc", "fuel"], touch_ingested_at=True
        )
    return total


def ingest_weather_archive(start: date, end: date) -> int:
    total = 0
    # The archive lags real time by a few days; never ask beyond yesterday.
    end = min(end, date.today() - timedelta(days=1))
    for loc in LOCATIONS.values():
        for year in _years(start, end):
            lo = max(start, date(year, 1, 1))
            hi = min(end, date(year, 12, 31))
            df = weather.fetch_archive(loc, lo, hi)
            total += db.upsert_df(
                df, "grid.weather_hourly", ["ts_utc", "location", "source"], touch_ingested_at=True
            )
    return total


def ingest_weather_forecast() -> int:
    total = 0
    for loc in LOCATIONS.values():
        df = weather.fetch_forecast(loc)
        total += db.upsert_df(
            df, "grid.weather_hourly", ["ts_utc", "location", "source"], touch_ingested_at=True
        )
    return total


def ingest_eccc(start: date, end: date) -> int:
    total = 0
    month = date(start.year, start.month, 1)
    while month <= end:
        try:
            df = weather.fetch_eccc_month(ECCC_OTTAWA_STATION_ID, month.year, month.month, "ottawa")
            total += db.upsert_df(
                df, "grid.weather_hourly", ["ts_utc", "location", "source"], touch_ingested_at=True
            )
        except NotFoundError:
            log.warning("ECCC: no data for %s", month)
        month = (month + timedelta(days=32)).replace(day=1)
    return total


def ingest_holidays(start: date, end: date) -> int:
    # Holidays are computed, so always cover a couple of future years for forecasts.
    years = range(min(start.year, 2015), max(end.year, date.today().year) + 3)
    return db.upsert_df(calendar.ontario_holidays(years), "grid.holidays", ["day", "region"])


_WATERMARK_SQL: dict[str, str] = {
    "ieso_demand": "select max(ts_utc) as ts from grid.ieso_zonal_demand",
    "ieso_fuel": "select max(ts_utc) as ts from grid.ieso_generation_fuel",
    "weather_archive": "select max(ts_utc) as ts from grid.weather_hourly where source = 'era5'",
    "eccc": "select max(ts_utc) as ts from grid.weather_hourly where source = 'eccc'",
}

_JOBS: dict[str, Callable[[date, date], int]] = {
    "ieso_demand": ingest_ieso_demand,
    "ieso_fuel": ingest_ieso_fuel,
    "weather_archive": ingest_weather_archive,
    "weather_forecast": lambda _start, _end: ingest_weather_forecast(),
    "eccc": ingest_eccc,
    "holidays": ingest_holidays,
}


def _midnight_utc(day: date) -> datetime:
    return datetime.combine(day, datetime.min.time(), tzinfo=UTC)


def run(
    sources: list[str] | None = None, start: date | None = None, end: date | None = None
) -> list[dict[str, object]]:
    """Run the requested sources. start=None means incremental from the last stored hour."""
    sources = sources or list(SOURCES)
    unknown = set(sources) - set(SOURCES)
    if unknown:
        raise ValueError(f"unknown sources: {sorted(unknown)}")
    end = end or date.today()

    results: list[dict[str, object]] = []
    for source in sources:
        run_id = db.execute(
            "insert into grid.ingestion_runs (source, range_end) values (%s, %s) returning id",
            (source, _midnight_utc(end)),
        )[0]["id"]
        try:
            watermark = _WATERMARK_SQL.get(source)
            range_start = start or (
                _incremental_start(watermark)
                if watermark
                else date.fromisoformat(get_settings().backfill_start)
            )
            rows = _JOBS[source](range_start, end)
            db.execute(
                "update grid.ingestion_runs set status = 'succeeded', rows_upserted = %s, "
                "range_start = %s, finished_at = now() where id = %s",
                (rows, _midnight_utc(range_start), run_id),
            )
            results.append({"source": source, "status": "succeeded", "rows": rows})
            log.info("ingest %s: %d rows", source, rows)
        except Exception as exc:
            log.exception("ingest %s failed", source)
            db.execute(
                "update grid.ingestion_runs set status = 'failed', message = %s, "
                "finished_at = now() where id = %s",
                (str(exc)[:2000], run_id),
            )
            results.append({"source": source, "status": "failed", "error": str(exc)})
    return results
