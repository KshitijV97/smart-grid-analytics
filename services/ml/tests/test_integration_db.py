"""End-to-end against a real Postgres: warehouse -> train -> forecast.

Runs only when TEST_DATABASE_URL points at a database with the migrations applied
(see `make test-integration`). Data is synthetic and only exercises the plumbing.
"""

from __future__ import annotations

import os
from datetime import date

import pandas as pd
import pytest

from gridml import config, db
from gridml.forecasting import ForecastRequest, run_forecast
from gridml.ingest.calendar import ontario_holidays
from gridml.ingest.weather import WEATHER_COLUMNS
from gridml.training import Split, TrainRequest, create_run, execute_run
from tests.conftest import make_synthetic_dataset

URL = os.environ.get("TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(not URL, reason="TEST_DATABASE_URL not set")


@pytest.fixture(scope="module")
def warehouse(tmp_path_factory):
    os.environ["DATABASE_URL"] = URL or ""
    os.environ["ARTIFACT_STORE"] = f"file://{tmp_path_factory.mktemp('models')}"
    config.get_settings.cache_clear()
    db.execute(
        "truncate grid.ieso_zonal_demand, grid.ieso_generation_fuel, grid.weather_hourly, "
        "grid.holidays, grid.models, grid.training_runs, grid.forecasts cascade"
    )
    ds = make_synthetic_dataset("2023-11-01", "2024-09-01")
    f = ds.frame.reset_index(names="ts_utc")
    db.upsert_df(
        f.assign(zone="Ottawa").rename(columns={"load_mw": "demand_mw"})[
            ["ts_utc", "zone", "demand_mw"]
        ],
        "grid.ieso_zonal_demand",
        ["ts_utc", "zone"],
    )
    fuel = pd.concat(
        [
            f[["ts_utc", "wind_gen_mw"]]
            .rename(columns={"wind_gen_mw": "output_mw"})
            .assign(fuel="WIND"),
            f[["ts_utc", "solar_gen_mw"]]
            .rename(columns={"solar_gen_mw": "output_mw"})
            .assign(fuel="SOLAR"),
        ]
    )
    db.upsert_df(fuel, "grid.ieso_generation_fuel", ["ts_utc", "fuel"])
    db.upsert_df(
        f[["ts_utc", *WEATHER_COLUMNS]].assign(location="ottawa", source="era5"),
        "grid.weather_hourly",
        ["ts_utc", "location", "source"],
    )
    db.upsert_df(ontario_holidays(range(2023, 2026)), "grid.holidays", ["day", "region"])
    yield


def test_train_then_forecast(warehouse):
    req = TrainRequest(
        algorithm="random_forest",
        params={"n_estimators": 20, "max_depth": 10},
        split=Split(
            train_start=date(2023, 12, 1),
            train_end=date(2024, 4, 30),
            val_start=date(2024, 5, 1),
            val_end=date(2024, 6, 30),
            test_start=date(2024, 7, 1),
            test_end=date(2024, 8, 15),
        ),
    )
    run_id = create_run(req)
    execute_run(run_id, req)
    run = db.execute(
        "select status, error, model_id from grid.training_runs where id = %s", (run_id,)
    )[0]
    assert run["status"] == "succeeded", run["error"]
    model_id = str(run["model_id"])
    model = db.execute("select metrics from grid.models where id = %s", (model_id,))[0]
    assert model["metrics"]["test"]["overall"]["mape"] < 20
    n_bt = db.execute(
        "select count(*) as n from grid.model_backtest where model_id = %s", (model_id,)
    )[0]["n"]
    assert n_bt > 24 * 60

    # Start just past the data: weather comes from climatology, load from recursion.
    out = run_forecast(ForecastRequest(model_id=model_id, hours=48))
    assert len(out["points"]) == 48
    assert all(p["predicted_mw"] is not None for p in out["points"])
    assert any("climatology" in n for n in out["notes"])
    saved = db.execute("select count(*) as n from grid.forecasts where model_id = %s", (model_id,))[
        0
    ]["n"]
    assert saved == 1

    # Back-test window inside the data scores itself.
    past = run_forecast(
        ForecastRequest(model_id=model_id, start=date(2024, 8, 1), hours=24, save=False)
    )
    assert past["accuracy"]["n"] == 24
