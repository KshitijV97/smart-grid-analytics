"""Scenario layer: hypothetical solar farm, wind farm and EV fleet.

NetLoad(t) = forecast demand(t) - Solar(t) - Wind(t) + EV(t)

Solar and wind are driven by the same real / forecast weather the demand model
uses; EV charging by the Ontario holiday calendar. Every number is a parameter.
"""

from __future__ import annotations

from collections.abc import Iterable
from datetime import date, timedelta

import numpy as np
import pandas as pd
import pvlib
from pydantic import BaseModel, Field

from gridml.config import LOCAL_TZ, LOCATIONS


class Scenario(BaseModel):
    solar_mw_ac: float = Field(0.0, ge=0, description="Solar farm AC capacity (MW)")
    solar_dc_ac_ratio: float = Field(1.2, ge=1, le=2)
    solar_tilt_deg: float = Field(30.0, ge=0, le=90)
    wind_mw: float = Field(0.0, ge=0, description="Wind farm rated capacity (MW)")
    wind_cut_in_ms: float = Field(3.0, ge=0)
    wind_rated_ms: float = Field(12.0, gt=0)
    wind_cut_out_ms: float = Field(25.0, gt=0)
    ev_count: int = Field(0, ge=0, description="Number of fleet EVs")
    ev_kwh_per_day: float = Field(60.0, ge=0, description="Energy per vehicle per workday (kWh)")
    ev_charger_kw: float = Field(7.5, gt=0)
    ev_charge_start_hour: int = Field(22, ge=0, le=23, description="Local hour charging starts")
    ev_off_day_factor: float = Field(0.3, ge=0, le=1, description="Weekend/holiday share")

    @property
    def active(self) -> bool:
        return self.solar_mw_ac > 0 or self.wind_mw > 0 or self.ev_count > 0


def solar_output_mw(weather: pd.DataFrame, s: Scenario) -> pd.Series:
    """PVWatts-style model: GHI -> plane-of-array -> cell temperature -> DC -> AC."""
    idx = weather.index
    if s.solar_mw_ac <= 0:
        return pd.Series(0.0, index=idx)
    loc = LOCATIONS["ottawa"]
    pos = pvlib.solarposition.ephemeris(idx, loc.latitude, loc.longitude)
    ghi = weather["shortwave_radiation_wm2"].fillna(0.0).clip(lower=0)
    erbs = pvlib.irradiance.erbs(ghi, pos["zenith"], idx)
    poa = pvlib.irradiance.get_total_irradiance(
        surface_tilt=s.solar_tilt_deg,
        surface_azimuth=180,
        solar_zenith=pos["apparent_zenith"],
        solar_azimuth=pos["azimuth"],
        dni=erbs["dni"],
        ghi=ghi,
        dhi=erbs["dhi"],
    )["poa_global"].fillna(0.0)
    wind_ms = weather["wind_speed_10m_kmh"].fillna(0.0) / 3.6
    cell = pvlib.temperature.faiman(poa, weather["temperature_c"].fillna(10.0), wind_ms)
    pdc0 = s.solar_mw_ac * s.solar_dc_ac_ratio
    dc = pvlib.pvsystem.pvwatts_dc(poa, cell, pdc0, gamma_pdc=-0.004) * (1 - 0.14)
    ac = np.minimum(dc * 0.96, s.solar_mw_ac)
    return pd.Series(np.clip(ac, 0, None), index=idx)


def wind_output_mw(weather: pd.DataFrame, s: Scenario) -> pd.Series:
    """Cubic power curve on 100 m (hub height) wind speed."""
    idx = weather.index
    if s.wind_mw <= 0:
        return pd.Series(0.0, index=idx)
    v = weather["wind_speed_100m_kmh"].fillna(0.0).to_numpy() / 3.6
    vci, vr, vco = s.wind_cut_in_ms, s.wind_rated_ms, s.wind_cut_out_ms
    ramp = (v**3 - vci**3) / (vr**3 - vci**3)
    out = np.where(v < vci, 0.0, np.where(v < vr, ramp, np.where(v <= vco, 1.0, 0.0)))
    return pd.Series(out * s.wind_mw, index=idx)


def ev_load_mw(index: pd.DatetimeIndex, holidays: Iterable[date], s: Scenario) -> pd.Series:
    """Fleet charges at full power from the start hour until each day's energy is delivered."""
    if s.ev_count <= 0:
        return pd.Series(0.0, index=index)
    hol = set(holidays)
    local = index.tz_convert(LOCAL_TZ)
    # Assign each hour to the "charging night" it belongs to (the evening it started).
    shifted = local - pd.Timedelta(hours=s.ev_charge_start_hour)
    night = shifted.date
    hours_in = shifted.hour  # 0 = start hour
    out = np.zeros(len(index))
    for i, (d, h) in enumerate(zip(night, hours_in, strict=True)):
        # Energy needed tomorrow morning depends on whether tomorrow is a workday.
        tomorrow = d + timedelta(days=1)
        off = tomorrow.weekday() >= 5 or tomorrow in hol
        kwh = s.ev_kwh_per_day * (s.ev_off_day_factor if off else 1.0)
        full_hours = kwh / s.ev_charger_kw
        if h < int(full_hours):
            frac = 1.0
        elif h < full_hours:
            frac = full_hours - int(full_hours)
        else:
            frac = 0.0
        out[i] = s.ev_count * s.ev_charger_kw * frac / 1000.0
    return pd.Series(out, index=index)


def apply(
    demand: pd.Series, weather: pd.DataFrame, holidays: Iterable[date], s: Scenario
) -> pd.DataFrame:
    solar = solar_output_mw(weather, s)
    wind = wind_output_mw(weather, s)
    ev = ev_load_mw(demand.index, holidays, s)
    return pd.DataFrame(
        {
            "solar_mw": solar,
            "wind_mw": wind,
            "ev_mw": ev,
            "net_load_mw": demand - solar - wind + ev,
        },
        index=demand.index,
    )
