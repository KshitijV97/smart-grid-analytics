import json

import pandas as pd

from gridml.ingest import ieso, weather
from gridml.ingest.calendar import ontario_holidays
from tests.conftest import FIXTURES


def test_zonal_demand_converts_est_hour_ending_to_utc():
    df = ieso.parse_zonal_demand_csv((FIXTURES / "PUB_DemandZonal_sample.csv").read_text())
    ottawa = df[df.zone == "Ottawa"].set_index("ts_utc")["demand_mw"]
    # Hour 1 on 2024-01-01 EST = 00:00-01:00 EST = 05:00 UTC (hour beginning).
    assert ottawa[pd.Timestamp("2024-01-01 05:00", tz="UTC")] == 1123
    assert ottawa[pd.Timestamp("2024-01-02 04:00", tz="UTC")] == 1200
    assert "Ontario" in set(df.zone)
    assert not {"Zone Total", "Diff", "Hour"} & set(df.zone)


def test_fuel_output_parses_namespaced_xml_and_skips_missing():
    df = ieso.parse_fuel_output_xml(
        (FIXTURES / "PUB_GenOutputbyFuelHourly_sample.xml").read_bytes()
    )
    wind = df[df.fuel == "WIND"].set_index("ts_utc")["output_mw"]
    assert wind[pd.Timestamp("2024-01-01 05:00", tz="UTC")] == 2150
    solar = df[df.fuel == "SOLAR"].set_index("ts_utc")["output_mw"]
    assert solar[pd.Timestamp("2024-01-01 17:00", tz="UTC")] == 210
    assert "BIOFUEL" not in set(df.fuel)


def test_open_meteo_payload():
    payload = {
        "hourly": {
            "time": ["2024-01-01T00:00", "2024-01-01T01:00"],
            "temperature_2m": [-3.0, -3.5],
            "wind_speed_100m": [20.0, None],
        }
    }
    df = weather.parse_open_meteo(json.loads(json.dumps(payload)), "ottawa", "era5")
    assert list(df.columns[:3]) == ["ts_utc", "location", "source"]
    assert df.iloc[0]["ts_utc"] == pd.Timestamp("2024-01-01 00:00", tz="UTC")
    assert df.iloc[1]["temperature_c"] == -3.5
    assert pd.isna(df.iloc[1]["wind_speed_100m_kmh"])


def test_eccc_csv_is_lst_plus_five():
    df = weather.parse_eccc_csv((FIXTURES / "eccc_sample.csv").read_text(), "ottawa")
    assert df.iloc[0]["ts_utc"] == pd.Timestamp("2024-01-01 05:00", tz="UTC")
    assert df.iloc[0]["temperature_c"] == -3.1
    assert df.iloc[0]["wind_speed_10m_kmh"] == 11
    assert len(df) == 2


def test_ontario_holidays_include_family_and_civic_day():
    names = set(ontario_holidays(range(2024, 2025))["name"])
    assert any("Family Day" in n for n in names)
    assert any("Civic Holiday" in n for n in names)
