"""IESO public reports: hourly zonal demand and hourly output by fuel type.

IESO reports use Eastern Standard Time all year (no daylight saving) and an
hour-ending convention (hour 1 = 00:00-01:00 EST). We convert to UTC
hour-beginning timestamps: ts_utc = date + (hour - 1) h + 5 h.
"""

from __future__ import annotations

import io
import xml.etree.ElementTree as ET
from datetime import date

import pandas as pd

from gridml.ingest.http import NotFoundError, get

BASE_URL = "https://reports-public.ieso.ca/public"
EST_OFFSET = pd.Timedelta(hours=5)
# Columns that are not zones.
_NON_ZONE = {"date", "hour", "interval", "zone total", "diff"}


def _to_utc(day: pd.Series, hour: pd.Series) -> pd.Series:
    local = pd.to_datetime(day) + pd.to_timedelta(hour.astype(int) - 1, unit="h")
    return (local + EST_OFFSET).dt.tz_localize("UTC")


def parse_zonal_demand_csv(text: str) -> pd.DataFrame:
    """Parse PUB_DemandZonal CSV into long format (ts_utc, zone, demand_mw)."""
    lines = [ln for ln in text.splitlines() if ln.strip() and not ln.startswith("\\")]
    header_idx = next(
        i for i, ln in enumerate(lines) if ln.lower().startswith("date,") and "hour" in ln.lower()
    )
    df = pd.read_csv(io.StringIO("\n".join(lines[header_idx:])))
    df.columns = [c.strip() for c in df.columns]
    lower = {c: c.lower() for c in df.columns}
    date_col = next(c for c, lc in lower.items() if lc == "date")
    hour_col = next(c for c, lc in lower.items() if lc == "hour")
    zone_cols = [c for c, lc in lower.items() if lc not in _NON_ZONE]
    long = df.melt(
        id_vars=[date_col, hour_col], value_vars=zone_cols, var_name="zone", value_name="demand_mw"
    )
    long["zone"] = long["zone"].replace({"Ontario Demand": "Ontario"})
    long["demand_mw"] = pd.to_numeric(long["demand_mw"], errors="coerce")
    long = long.dropna(subset=["demand_mw"])
    long["ts_utc"] = _to_utc(long[date_col], long[hour_col])
    # Some newer files carry 5-minute intervals; average them to hourly.
    out = long.groupby(["ts_utc", "zone"], as_index=False)["demand_mw"].mean()
    return out[["ts_utc", "zone", "demand_mw"]]


def _strip_ns(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def parse_fuel_output_xml(text: str | bytes) -> pd.DataFrame:
    """Parse PUB_GenOutputbyFuelHourly XML into (ts_utc, fuel, output_mw)."""
    root = ET.fromstring(text)
    rows: list[tuple[str, int, str, float]] = []
    for daily in root.iter():
        if _strip_ns(daily.tag) != "DailyData":
            continue
        day = next((c.text for c in daily if _strip_ns(c.tag) == "Day"), None)
        if not day:
            continue
        for hourly in daily:
            if _strip_ns(hourly.tag) != "HourlyData":
                continue
            hour = next((c.text for c in hourly if _strip_ns(c.tag) == "Hour"), None)
            if not hour:
                continue
            for fuel_total in hourly:
                if _strip_ns(fuel_total.tag) != "FuelTotal":
                    continue
                fuel = None
                output = None
                for el in fuel_total.iter():
                    name = _strip_ns(el.tag)
                    if name == "Fuel":
                        fuel = (el.text or "").strip().upper()
                    elif name == "Output" and el.text and el.text.strip():
                        output = float(el.text)
                if fuel and output is not None:
                    rows.append((day, int(hour), fuel, output))
    df = pd.DataFrame(rows, columns=["day", "hour", "fuel", "output_mw"])
    if df.empty:
        return pd.DataFrame(columns=["ts_utc", "fuel", "output_mw"])
    df["ts_utc"] = _to_utc(df["day"], df["hour"])
    return df[["ts_utc", "fuel", "output_mw"]]


def fetch_zonal_demand(year: int) -> pd.DataFrame:
    urls = [f"{BASE_URL}/DemandZonal/PUB_DemandZonal_{year}.csv"]
    if year == date.today().year:
        urls.append(f"{BASE_URL}/DemandZonal/PUB_DemandZonal.csv")
    for url in urls:
        try:
            return parse_zonal_demand_csv(get(url).text)
        except NotFoundError:
            continue
    raise NotFoundError(f"no zonal demand file for {year}")


def fetch_fuel_output(year: int) -> pd.DataFrame:
    urls = [f"{BASE_URL}/GenOutputbyFuelHourly/PUB_GenOutputbyFuelHourly_{year}.xml"]
    if year == date.today().year:
        urls.append(f"{BASE_URL}/GenOutputbyFuelHourly/PUB_GenOutputbyFuelHourly.xml")
    for url in urls:
        try:
            return parse_fuel_output_xml(get(url).content)
        except NotFoundError:
            continue
    raise NotFoundError(f"no fuel output file for {year}")
