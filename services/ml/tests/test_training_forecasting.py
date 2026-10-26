import numpy as np
import pandas as pd
import pytest

from gridml import algorithms
from gridml.forecasting import forecast_with_bundle
from gridml.scenario import Scenario
from gridml.training import Split, TrainRequest, train_model


def fast_params(key):
    return {
        "random_forest": {"n_estimators": 20, "max_depth": 12},
        "xgboost": {"n_estimators": 200, "early_stopping_rounds": 20},
        "extra_trees": {"n_estimators": 20},
        "hist_gradient_boosting": {"max_iter": 50},
        "mlp": {"max_iter": 20, "hidden_layers": "64"},
    }.get(key, {})


@pytest.mark.parametrize("key", sorted(algorithms.ALGORITHMS))
def test_every_algorithm_trains_and_beats_mean(key, synthetic, small_split):
    req = TrainRequest(algorithm=key, params=fast_params(key), split=Split(**small_split))
    res = train_model(req, synthetic, progress=lambda _m: None)
    val = res.metrics["validation"]["overall"]
    y = synthetic.frame["load_mw"]
    assert val["mae"] < float(np.mean(np.abs(y - y.mean())))
    assert res.metrics["test"]["daily_baseload"]["n"] > 100
    assert set(res.backtest["split"]) == {"validation", "test"}
    assert abs(sum(f["importance"] for f in res.feature_importance) - 1) < 1e-6


def test_xgboost_refit_uses_best_iteration(synthetic, small_split):
    req = TrainRequest(
        algorithm="xgboost", params=fast_params("xgboost"), split=Split(**small_split)
    )
    res = train_model(req, synthetic, progress=lambda _m: None)
    assert res.params["early_stopping_rounds"] == 0
    assert res.params["n_estimators"] <= 200


def test_random_search_runs(synthetic, small_split):
    req = TrainRequest(algorithm="ridge", split=Split(**small_split), search_iterations=2)
    res = train_model(req, synthetic, progress=lambda _m: None)
    assert "alpha" in res.params


def test_unknown_param_rejected():
    with pytest.raises(ValueError):
        algorithms.get("random_forest").resolve({"n_trees": 3})


def test_split_must_be_ordered():
    with pytest.raises(ValueError):
        Split(train_end=pd.Timestamp("2024-06-01").date())


@pytest.fixture(scope="module")
def rf_bundle(synthetic):
    split = Split(
        train_start="2023-01-01",
        train_end="2023-12-31",
        val_start="2024-01-01",
        val_end="2024-06-30",
        test_start="2024-07-01",
        test_end="2025-02-28",
    )
    req = TrainRequest(algorithm="random_forest", params=fast_params("random_forest"), split=split)
    return train_model(req, synthetic, progress=lambda _m: None).bundle


def test_recursive_forecast_with_base_and_variable_load(rf_bundle, synthetic):
    start = pd.Timestamp("2025-01-10 05:00", tz="UTC")  # local midnight
    out = forecast_with_bundle(rf_bundle, synthetic, start, 72)
    pts = pd.DataFrame(out["points"])
    assert len(pts) == 72
    assert pts["predicted_mw"].notna().all()
    assert (pts["variable_mw"] >= -1e-6).all()
    assert len(out["daily"]) == 3
    for day in out["daily"]:
        assert day["baseload_mw"] <= day["mean_mw"] <= day["peak_mw"]
    # Actuals exist in the synthetic frame, so the forecast scores itself.
    assert out["accuracy"]["mape"] < 15
    assert any("recursively" in n for n in out["notes"])


def test_forecast_bridges_gap_after_last_observation(rf_bundle, synthetic):
    ds = type(synthetic)(frame=synthetic.frame.copy(), holidays=synthetic.holidays)
    start = pd.Timestamp("2025-01-10 05:00", tz="UTC")
    ds.frame.loc[start - pd.Timedelta(hours=30) :, "load_mw"] = np.nan
    out = forecast_with_bundle(rf_bundle, ds, start, 24)
    assert out["accuracy"] is None
    assert any("before the start" in n for n in out["notes"])


def test_scenario_net_load(rf_bundle, synthetic):
    start = pd.Timestamp("2024-07-15 04:00", tz="UTC")
    scen = Scenario(solar_mw_ac=10, wind_mw=20, ev_count=300)
    out = forecast_with_bundle(rf_bundle, synthetic, start, 48, scen=scen)
    pts = pd.DataFrame(out["points"])
    assert pts["solar_mw"].max() > 3
    assert pts["solar_mw"].max() <= 10 + 1e-6
    assert pts["wind_mw"].between(0, 20).all()
    # 300 vehicles x 7.5 kW = 2.25 MW while charging.
    assert pts["ev_mw"].max() == pytest.approx(2.25)
    recon = pts["predicted_mw"] - pts["solar_mw"] - pts["wind_mw"] + pts["ev_mw"]
    assert np.allclose(recon, pts["net_load_mw"], atol=0.05)
