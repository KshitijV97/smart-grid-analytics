"""Model training with a chronological train / validation / test split."""

from __future__ import annotations

import itertools
import logging
import time
import uuid
from collections.abc import Callable
from dataclasses import dataclass
from datetime import date, timedelta
from typing import Any

import numpy as np
import pandas as pd
from pydantic import BaseModel, Field, model_validator
from sklearn.base import RegressorMixin
from sklearn.inspection import permutation_importance

from gridml import algorithms, artifacts, db, jsonutil
from gridml.config import LOCAL_TZ
from gridml.features import DEFAULT_GROUPS, FeatureConfig, build_features
from gridml.metrics import breakdown, regression_metrics
from gridml.warehouse import Dataset, load_dataset

log = logging.getLogger(__name__)

WARMUP = timedelta(days=21)  # history needed before train_start for the 336 h lag


class Split(BaseModel):
    """Inclusive local (America/Toronto) dates."""

    train_start: date = date(2020, 1, 1)
    train_end: date = date(2023, 12, 31)
    val_start: date = date(2024, 1, 1)
    val_end: date = date(2024, 12, 31)
    test_start: date = date(2025, 1, 1)
    test_end: date = date(2025, 12, 31)

    @model_validator(mode="after")
    def _ordered(self) -> Split:
        seq = [
            self.train_start,
            self.train_end,
            self.val_start,
            self.val_end,
            self.test_start,
            self.test_end,
        ]
        if any(a > b for a, b in itertools.pairwise(seq)):
            raise ValueError("split dates must be in order train < validation < test")
        if self.train_end >= self.val_start or self.val_end >= self.test_start:
            raise ValueError("train, validation and test periods must not overlap")
        return self


class TrainRequest(BaseModel):
    algorithm: str = "random_forest"
    params: dict[str, Any] = Field(default_factory=dict)
    target_zone: str = "Ottawa"
    horizon_hours: int = Field(24, ge=1, le=168)
    feature_groups: list[str] = Field(default_factory=lambda: list(DEFAULT_GROUPS))
    split: Split = Field(default_factory=Split)
    search_iterations: int = Field(0, ge=0, le=50)
    refit_on_train_val: bool = True
    name: str | None = None


@dataclass
class TrainResult:
    bundle: dict[str, Any]
    params: dict[str, Any]
    metrics: dict[str, Any]
    feature_importance: list[dict[str, float | str]]
    residual_quantiles: dict[str, list[float]]
    backtest: pd.DataFrame
    seconds: float


def _local_day(index: pd.DatetimeIndex) -> np.ndarray:
    return np.asarray(index.tz_convert(LOCAL_TZ).date)


def make_xy(dataset: Dataset, cfg: FeatureConfig) -> tuple[pd.DataFrame, pd.Series]:
    X = build_features(dataset.frame, dataset.holidays, cfg)
    y = dataset.frame["load_mw"].reindex(X.index)
    return X, y


def _fit(
    algo: algorithms.Algorithm,
    params: dict[str, Any],
    X: pd.DataFrame,
    y: pd.Series,
    X_val: pd.DataFrame | None = None,
    y_val: pd.Series | None = None,
) -> RegressorMixin:
    model = algo.build(params, list(X.columns))
    if algo.supports_early_stopping and params.get("early_stopping_rounds"):
        if X_val is None or y_val is None:
            raise ValueError("early stopping needs a validation set")
        model.fit(X, y, eval_set=[(X_val, y_val)], verbose=False)
    else:
        model.fit(X, y)
    return model


def _importance(
    model: RegressorMixin, X_val: pd.DataFrame, y_val: pd.Series
) -> list[dict[str, float | str]]:
    raw = getattr(model, "feature_importances_", None)
    if raw is None:
        sample = X_val.sample(min(len(X_val), 2000), random_state=0)
        res = permutation_importance(
            model,
            sample,
            y_val.loc[sample.index],
            n_repeats=3,
            random_state=0,
            scoring="neg_mean_absolute_error",
        )
        raw = np.clip(res.importances_mean, 0, None)
    total = float(np.sum(raw)) or 1.0
    pairs = sorted(zip(X_val.columns, raw, strict=True), key=lambda kv: -kv[1])
    return [{"feature": f, "importance": float(v) / total} for f, v in pairs]


def train_model(
    req: TrainRequest, dataset: Dataset, progress: Callable[[str], None] = log.info
) -> TrainResult:
    t0 = time.perf_counter()
    algo = algorithms.get(req.algorithm)
    params = algo.resolve(req.params)
    cfg = FeatureConfig(horizon_hours=req.horizon_hours, groups=tuple(req.feature_groups))
    X, y = make_xy(dataset, cfg)
    days = _local_day(X.index)
    s = req.split

    def part(lo: date, hi: date) -> tuple[pd.DataFrame, pd.Series]:
        mask = (days >= lo) & (days <= hi) & y.notna().to_numpy()
        Xp, yp = X[mask], y[mask]
        # Drop warm-up rows where lag features are not yet available.
        keep = Xp.notna().mean(axis=1) > 0.9
        return Xp[keep], yp[keep]

    X_tr, y_tr = part(s.train_start, s.train_end)
    X_va, y_va = part(s.val_start, s.val_end)
    X_te, y_te = part(s.test_start, s.test_end)
    progress(
        f"rows: train={len(X_tr)} validation={len(X_va)} test={len(X_te)}; {X.shape[1]} features"
    )
    if len(X_tr) < 24 * 30 or len(X_va) < 24 * 7:
        raise ValueError("not enough data in the train/validation periods; run ingestion first")

    if req.search_iterations and algo.tunable:
        rng = np.random.default_rng(params.get("random_state", 0))
        best = (float("inf"), params)
        candidates = [params] + [algo.sample(rng, params) for _ in range(req.search_iterations)]
        for i, cand in enumerate(candidates):
            model = _fit(algo, cand, X_tr, y_tr, X_va, y_va)
            mae = regression_metrics(y_va, model.predict(X_va))["mae"]
            progress(f"search {i}/{req.search_iterations}: validation MAE {mae:.2f} MW {cand}")
            if mae < best[0]:
                best = (mae, cand)
        params = best[1]
        progress(f"best validation MAE {best[0]:.2f} MW with {params}")

    progress(f"fitting {algo.label} on the training period")
    model = _fit(algo, params, X_tr, y_tr, X_va, y_va)
    if algo.supports_early_stopping and params.get("early_stopping_rounds"):
        best_iter = int(getattr(model, "best_iteration", params["n_estimators"] - 1))
        params = params | {"n_estimators": best_iter + 1, "early_stopping_rounds": 0}
        progress(f"early stopping kept {best_iter + 1} boosting rounds")
    pred_va = model.predict(X_va)
    importance = _importance(model, X_va, y_va)

    # Residual quantiles by local hour on validation -> prediction intervals.
    resid = pd.Series(y_va.to_numpy() - pred_va, index=X_va.index)
    hours = resid.index.tz_convert(LOCAL_TZ).hour
    quantiles = {
        str(q): [
            float(resid[hours == h].quantile(q)) if (hours == h).any() else 0.0 for h in range(24)
        ]
        for q in (0.05, 0.1, 0.5, 0.9, 0.95)
    }

    final = model
    if req.refit_on_train_val:
        progress("refitting on train + validation for the test year and live forecasts")
        final = _fit(algo, params, pd.concat([X_tr, X_va]), pd.concat([y_tr, y_va]))
    pred_te = final.predict(X_te) if len(X_te) else np.array([])

    naive_col = "load_lag_168h"
    metrics: dict[str, Any] = {
        "train": regression_metrics(y_tr, model.predict(X_tr)),
        "validation": breakdown(pd.Series(X_va.index), y_va, pd.Series(pred_va), dataset.holidays),
    }
    if len(X_te):
        metrics["test"] = breakdown(
            pd.Series(X_te.index), y_te, pd.Series(pred_te), dataset.holidays
        )
    if naive_col in X.columns:
        # Seasonal-naive reference: "same hour last week".
        metrics["naive_weekly"] = {
            "validation": regression_metrics(y_va, X_va[naive_col]),
            "test": regression_metrics(y_te, X_te[naive_col]) if len(X_te) else None,
        }

    backtest = pd.concat(
        [
            pd.DataFrame(
                {
                    "ts_utc": X_va.index,
                    "split": "validation",
                    "actual": y_va.to_numpy(),
                    "predicted": pred_va,
                }
            ),
            pd.DataFrame(
                {
                    "ts_utc": X_te.index,
                    "split": "test",
                    "actual": y_te.to_numpy(),
                    "predicted": pred_te,
                }
            ),
        ],
        ignore_index=True,
    )
    bundle = {
        "model": final,
        "algorithm": algo.key,
        "params": params,
        "feature_columns": list(X.columns),
        "feature_config": {"horizon_hours": cfg.horizon_hours, "groups": list(cfg.groups)},
        "target_zone": req.target_zone,
        "residual_quantiles": quantiles,
    }
    seconds = time.perf_counter() - t0
    progress(f"done in {seconds:.1f}s")
    return TrainResult(bundle, params, metrics, importance, quantiles, backtest, seconds)


def create_run(req: TrainRequest) -> str:
    rows = db.execute(
        "insert into grid.training_runs (algorithm, request) values (%s, %s::jsonb) returning id",
        (req.algorithm, req.model_dump_json()),
    )
    return str(rows[0]["id"])


def execute_run(run_id: str, req: TrainRequest) -> None:
    """Load data, train, persist the model and its back-test. Updates the run row."""
    lines: list[str] = []

    def progress(msg: str) -> None:
        log.info("[run %s] %s", run_id, msg)
        lines.append(msg)
        db.execute(
            "update grid.training_runs set log = %s where id = %s", ("\n".join(lines), run_id)
        )

    db.execute(
        "update grid.training_runs set status = 'running', started_at = now() where id = %s",
        (run_id,),
    )
    try:
        s = req.split
        start = pd.Timestamp(s.train_start, tz=LOCAL_TZ).tz_convert("UTC") - WARMUP
        end = pd.Timestamp(s.test_end + timedelta(days=1), tz=LOCAL_TZ).tz_convert("UTC")
        progress(f"loading {req.target_zone} data {start:%Y-%m-%d} .. {end:%Y-%m-%d}")
        dataset = load_dataset(req.target_zone, start, end)
        result = train_model(req, dataset, progress)

        model_id = str(uuid.uuid4())
        uri = artifacts.save(result.bundle, f"models/{model_id}.joblib")
        algo = algorithms.get(req.algorithm)
        name = req.name or f"{algo.label} · {req.target_zone} · {req.horizon_hours}h"
        db.execute(
            """
            insert into grid.models (id, name, algorithm, target_zone, horizon_hours, params,
                features, split, metrics, feature_importance, residual_quantiles, artifact_uri,
                training_run_id, train_seconds)
            values (%s, %s, %s, %s, %s, %s::jsonb, %s::jsonb, %s::jsonb, %s::jsonb, %s::jsonb,
                    %s::jsonb, %s, %s, %s)
            """,
            (
                model_id,
                name,
                req.algorithm,
                req.target_zone,
                req.horizon_hours,
                jsonutil.dumps(result.params),
                jsonutil.dumps(result.bundle["feature_columns"]),
                req.split.model_dump_json(),
                jsonutil.dumps(result.metrics),
                jsonutil.dumps(result.feature_importance),
                jsonutil.dumps(result.residual_quantiles),
                uri,
                run_id,
                result.seconds,
            ),
        )
        bt = result.backtest.assign(model_id=model_id)
        db.upsert_df(
            bt[["model_id", "ts_utc", "split", "actual", "predicted"]],
            "grid.model_backtest",
            ["model_id", "ts_utc"],
        )
        db.execute(
            "update grid.training_runs set status = 'succeeded', model_id = %s, "
            "finished_at = now() where id = %s",
            (model_id, run_id),
        )
    except Exception as exc:
        log.exception("training run %s failed", run_id)
        lines.append(f"ERROR: {exc}")
        db.execute(
            "update grid.training_runs set status = 'failed', error = %s, log = %s, "
            "finished_at = now() where id = %s",
            (str(exc)[:4000], "\n".join(lines), run_id),
        )
