from datetime import date

import numpy as np
import pandas as pd
import pytest

from gridml.features import FeatureConfig, build_features, local_calendar


def test_horizon_controls_which_lags_exist(synthetic):
    day_ahead = build_features(synthetic.frame.iloc[:1000], synthetic.holidays, FeatureConfig(24))
    hour_ahead = build_features(synthetic.frame.iloc[:1000], synthetic.holidays, FeatureConfig(1))
    assert "load_lag_1h" not in day_ahead.columns
    assert "load_lag_24h" in day_ahead.columns
    assert "load_lag_1h" in hour_ahead.columns


def test_features_never_use_load_inside_the_horizon(synthetic):
    frame = synthetic.frame.iloc[:2000].copy()
    cfg = FeatureConfig(24)
    base = build_features(frame, synthetic.holidays, cfg)
    t = frame.index[1500]
    # Changing load in the 23 h before t must not change features at t.
    frame.loc[t - pd.Timedelta(hours=23) : t, "load_mw"] += 500
    moved = build_features(frame, synthetic.holidays, cfg)
    load_cols = [c for c in base.columns if c.startswith("load_")]
    pd.testing.assert_series_equal(base.loc[t, load_cols], moved.loc[t, load_cols])


def test_calendar_marks_holidays_in_local_time():
    idx = pd.date_range("2024-07-01 03:00", periods=3, freq="h", tz="UTC")
    cal = local_calendar(idx, {date(2024, 7, 1)})
    # 03:00 UTC on Jul 1 is 23:00 on Jun 30 in Ottawa (EDT); 04:00 UTC is local midnight.
    assert cal["is_holiday"].tolist() == [0, 1, 1]
    assert cal["is_dst"].tolist() == [1, 1, 1]


def test_unknown_group_rejected():
    with pytest.raises(ValueError):
        FeatureConfig(24, ("calendar", "astrology"))


def test_solar_features_zero_at_night(synthetic):
    X = build_features(
        synthetic.frame.iloc[:200], synthetic.holidays, FeatureConfig(24, ("solar",))
    )
    night = X[X["sun_elevation"] < -5]
    assert np.allclose(night["clear_sky_ghi"], 0)
