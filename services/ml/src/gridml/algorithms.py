"""Algorithm registry: estimators, hyperparameter schemas and search spaces.

The UI renders its training form from `describe()`, so adding an algorithm here
makes it selectable end to end.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import asdict, dataclass, field
from typing import Any, Literal

import numpy as np
from sklearn.base import RegressorMixin
from sklearn.compose import ColumnTransformer, TransformedTargetRegressor
from sklearn.ensemble import (
    ExtraTreesRegressor,
    HistGradientBoostingRegressor,
    RandomForestRegressor,
)
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LinearRegression, Ridge
from sklearn.neural_network import MLPRegressor
from sklearn.pipeline import Pipeline, make_pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler
from xgboost import XGBRegressor

ParamType = Literal["int", "float", "bool", "choice"]
CATEGORICAL = ("hour", "dow", "month")


@dataclass(frozen=True)
class ParamSpec:
    name: str
    type: ParamType
    default: Any
    description: str
    min: float | None = None
    max: float | None = None
    step: float | None = None
    choices: tuple[Any, ...] | None = None
    # Random-search range (inclusive); None means "not tuned".
    search: tuple[float, float] | None = None
    log: bool = False
    nullable: bool = False

    def sample(self, rng: np.random.Generator) -> Any:
        assert self.search is not None
        lo, hi = self.search
        value = float(
            np.exp(rng.uniform(np.log(lo), np.log(hi))) if self.log else rng.uniform(lo, hi)
        )
        return round(value) if self.type == "int" else round(value, 5)


@dataclass(frozen=True)
class Algorithm:
    key: str
    label: str
    family: str
    description: str
    params: tuple[ParamSpec, ...]
    build: Callable[[dict[str, Any], list[str]], RegressorMixin]
    priority: int
    supports_early_stopping: bool = False
    tags: tuple[str, ...] = field(default_factory=tuple)

    def defaults(self) -> dict[str, Any]:
        return {p.name: p.default for p in self.params}

    def resolve(self, overrides: dict[str, Any] | None) -> dict[str, Any]:
        params = self.defaults()
        for name, value in (overrides or {}).items():
            spec = next((p for p in self.params if p.name == name), None)
            if spec is None:
                raise ValueError(f"{self.key}: unknown parameter {name!r}")
            params[name] = _coerce(spec, value)
        return params

    def sample(self, rng: np.random.Generator, base: dict[str, Any]) -> dict[str, Any]:
        params = dict(base)
        for spec in self.params:
            if spec.search is not None:
                params[spec.name] = spec.sample(rng)
        return params

    @property
    def tunable(self) -> bool:
        return any(p.search is not None for p in self.params)


def _coerce(spec: ParamSpec, value: Any) -> Any:
    if value is None:
        if not spec.nullable:
            raise ValueError(f"{spec.name} cannot be empty")
        return None
    if spec.type == "int":
        value = int(value)
    elif spec.type == "float":
        value = float(value)
    elif spec.type == "bool":
        value = bool(value)
    elif spec.type == "choice":
        if spec.choices is None or value not in spec.choices:
            raise ValueError(f"{spec.name} must be one of {spec.choices}")
        return value
    if spec.min is not None and value < spec.min:
        raise ValueError(f"{spec.name} must be >= {spec.min}")
    if spec.max is not None and value > spec.max:
        raise ValueError(f"{spec.name} must be <= {spec.max}")
    return value


def _linear_preprocessor(columns: list[str]) -> ColumnTransformer:
    cats = [c for c in CATEGORICAL if c in columns]
    nums = [c for c in columns if c not in cats]
    return ColumnTransformer(
        [
            ("cat", OneHotEncoder(handle_unknown="ignore"), cats),
            ("num", make_pipeline(SimpleImputer(strategy="median"), StandardScaler()), nums),
        ]
    )


def _random_forest(p: dict[str, Any], _cols: list[str]) -> RegressorMixin:
    return RandomForestRegressor(
        n_estimators=p["n_estimators"],
        max_depth=p["max_depth"],
        min_samples_leaf=p["min_samples_leaf"],
        max_features=p["max_features"],
        max_samples=p["max_samples"] if p["bootstrap"] else None,
        bootstrap=p["bootstrap"],
        n_jobs=-1,
        random_state=p["random_state"],
    )


def _extra_trees(p: dict[str, Any], _cols: list[str]) -> RegressorMixin:
    return ExtraTreesRegressor(
        n_estimators=p["n_estimators"],
        max_depth=p["max_depth"],
        min_samples_leaf=p["min_samples_leaf"],
        max_features=p["max_features"],
        n_jobs=-1,
        random_state=p["random_state"],
    )


def _xgboost(p: dict[str, Any], _cols: list[str]) -> RegressorMixin:
    return XGBRegressor(
        n_estimators=p["n_estimators"],
        learning_rate=p["learning_rate"],
        max_depth=p["max_depth"],
        min_child_weight=p["min_child_weight"],
        subsample=p["subsample"],
        colsample_bytree=p["colsample_bytree"],
        reg_lambda=p["reg_lambda"],
        reg_alpha=p["reg_alpha"],
        early_stopping_rounds=p["early_stopping_rounds"] or None,
        tree_method="hist",
        objective="reg:squarederror",
        n_jobs=-1,
        random_state=p["random_state"],
    )


def _hist_gb(p: dict[str, Any], _cols: list[str]) -> RegressorMixin:
    return HistGradientBoostingRegressor(
        learning_rate=p["learning_rate"],
        max_iter=p["max_iter"],
        max_leaf_nodes=p["max_leaf_nodes"],
        min_samples_leaf=p["min_samples_leaf"],
        l2_regularization=p["l2_regularization"],
        random_state=p["random_state"],
    )


def _linear(_p: dict[str, Any], cols: list[str]) -> RegressorMixin:
    model: RegressorMixin = Pipeline(
        [("prep", _linear_preprocessor(cols)), ("lr", LinearRegression())]
    )
    return model


def _ridge(p: dict[str, Any], cols: list[str]) -> RegressorMixin:
    model: RegressorMixin = Pipeline(
        [("prep", _linear_preprocessor(cols)), ("ridge", Ridge(alpha=p["alpha"]))]
    )
    return model


def _mlp(p: dict[str, Any], cols: list[str]) -> RegressorMixin:
    layers = tuple(int(x) for x in str(p["hidden_layers"]).split("-"))
    net = Pipeline(
        [
            ("prep", _linear_preprocessor(cols)),
            (
                "mlp",
                MLPRegressor(
                    hidden_layer_sizes=layers,
                    alpha=p["alpha"],
                    learning_rate_init=p["learning_rate_init"],
                    max_iter=p["max_iter"],
                    early_stopping=True,
                    random_state=p["random_state"],
                ),
            ),
        ]
    )
    # Networks train badly on raw megawatts; standardise the target too.
    model: RegressorMixin = TransformedTargetRegressor(regressor=net, transformer=StandardScaler())
    return model


SEED = ParamSpec("random_state", "int", 42, "Random seed (for reproducible results)", min=0)

ALGORITHMS: dict[str, Algorithm] = {
    a.key: a
    for a in [
        Algorithm(
            key="random_forest",
            label="Random Forest",
            family="Bagged trees",
            description="Primary model. Averages many deep decision trees trained on bootstrap "
            "samples; robust, little tuning, gives feature importances.",
            priority=1,
            tags=("primary",),
            params=(
                ParamSpec(
                    "n_estimators", "int", 300, "Number of trees", 10, 2000, 10, search=(100, 600)
                ),
                ParamSpec(
                    "max_depth",
                    "int",
                    24,
                    "Maximum tree depth (empty = unlimited)",
                    2,
                    100,
                    nullable=True,
                    search=(10, 40),
                ),
                ParamSpec(
                    "min_samples_leaf", "int", 2, "Minimum samples per leaf", 1, 100, search=(1, 20)
                ),
                ParamSpec(
                    "max_features",
                    "float",
                    0.5,
                    "Fraction of features tried per split",
                    0.05,
                    1.0,
                    0.05,
                    search=(0.2, 1.0),
                ),
                ParamSpec("bootstrap", "bool", True, "Sample rows with replacement per tree"),
                ParamSpec(
                    "max_samples",
                    "float",
                    0.8,
                    "Fraction of rows per tree (bootstrap only)",
                    0.1,
                    1.0,
                    0.05,
                    search=(0.4, 1.0),
                ),
                SEED,
            ),
            build=_random_forest,
        ),
        Algorithm(
            key="xgboost",
            label="XGBoost",
            family="Gradient-boosted trees",
            description="Secondary model. Adds shallow trees one at a time, each correcting the "
            "previous errors; early stopping on the validation year.",
            priority=2,
            supports_early_stopping=True,
            params=(
                ParamSpec("n_estimators", "int", 3000, "Maximum boosting rounds", 10, 20000, 50),
                ParamSpec(
                    "learning_rate",
                    "float",
                    0.03,
                    "Shrinkage per round",
                    0.001,
                    1.0,
                    0.005,
                    search=(0.01, 0.2),
                    log=True,
                ),
                ParamSpec("max_depth", "int", 7, "Maximum tree depth", 1, 20, search=(3, 12)),
                ParamSpec(
                    "min_child_weight",
                    "float",
                    3.0,
                    "Minimum hessian per leaf",
                    0,
                    100,
                    search=(1, 20),
                    log=True,
                ),
                ParamSpec(
                    "subsample",
                    "float",
                    0.8,
                    "Row fraction per round",
                    0.1,
                    1.0,
                    0.05,
                    search=(0.5, 1.0),
                ),
                ParamSpec(
                    "colsample_bytree",
                    "float",
                    0.8,
                    "Feature fraction per tree",
                    0.1,
                    1.0,
                    0.05,
                    search=(0.4, 1.0),
                ),
                ParamSpec(
                    "reg_lambda",
                    "float",
                    1.0,
                    "L2 regularisation",
                    0,
                    100,
                    search=(0.1, 20),
                    log=True,
                ),
                ParamSpec("reg_alpha", "float", 0.0, "L1 regularisation", 0, 100),
                ParamSpec(
                    "early_stopping_rounds",
                    "int",
                    150,
                    "Stop after this many rounds without validation improvement (0 = off)",
                    0,
                    2000,
                ),
                SEED,
            ),
            build=_xgboost,
        ),
        Algorithm(
            key="hist_gradient_boosting",
            label="Histogram Gradient Boosting",
            family="Gradient-boosted trees",
            description="scikit-learn's LightGBM-style booster; a fast second opinion on XGBoost.",
            priority=3,
            params=(
                ParamSpec(
                    "learning_rate",
                    "float",
                    0.05,
                    "Shrinkage per iteration",
                    0.001,
                    1.0,
                    0.005,
                    search=(0.01, 0.2),
                    log=True,
                ),
                ParamSpec(
                    "max_iter", "int", 800, "Boosting iterations", 10, 10000, 10, search=(200, 2000)
                ),
                ParamSpec(
                    "max_leaf_nodes", "int", 63, "Leaves per tree", 2, 1024, search=(15, 255)
                ),
                ParamSpec(
                    "min_samples_leaf",
                    "int",
                    20,
                    "Minimum samples per leaf",
                    1,
                    1000,
                    search=(5, 100),
                ),
                ParamSpec("l2_regularization", "float", 0.0, "L2 regularisation", 0, 100),
                SEED,
            ),
            build=_hist_gb,
        ),
        Algorithm(
            key="extra_trees",
            label="Extra Trees",
            family="Bagged trees",
            description="Like Random Forest but with random split thresholds; faster, "
            "sometimes smoother.",
            priority=4,
            params=(
                ParamSpec(
                    "n_estimators", "int", 300, "Number of trees", 10, 2000, 10, search=(100, 600)
                ),
                ParamSpec(
                    "max_depth",
                    "int",
                    28,
                    "Maximum tree depth (empty = unlimited)",
                    2,
                    100,
                    nullable=True,
                    search=(10, 40),
                ),
                ParamSpec(
                    "min_samples_leaf", "int", 2, "Minimum samples per leaf", 1, 100, search=(1, 20)
                ),
                ParamSpec(
                    "max_features",
                    "float",
                    0.7,
                    "Fraction of features tried per split",
                    0.05,
                    1.0,
                    0.05,
                    search=(0.2, 1.0),
                ),
                SEED,
            ),
            build=_extra_trees,
        ),
        Algorithm(
            key="linear_regression",
            label="Linear Regression",
            family="Linear",
            description="Baseline. Ordinary least squares on scaled features with one-hot "
            "hour, weekday and month.",
            priority=5,
            tags=("baseline",),
            params=(),
            build=_linear,
        ),
        Algorithm(
            key="ridge",
            label="Ridge Regression",
            family="Linear",
            description="Linear baseline with L2 regularisation.",
            priority=6,
            params=(
                ParamSpec(
                    "alpha",
                    "float",
                    1.0,
                    "Regularisation strength",
                    0.0,
                    10000.0,
                    search=(0.01, 100),
                    log=True,
                ),
            ),
            build=_ridge,
        ),
        Algorithm(
            key="mlp",
            label="Neural network (MLP)",
            family="Neural network",
            description="Feed-forward neural network on scaled features (a light stand-in for "
            "the LSTM stretch goal).",
            priority=7,
            params=(
                ParamSpec(
                    "hidden_layers",
                    "choice",
                    "128-64",
                    "Hidden layer sizes",
                    choices=("64", "128", "64-32", "128-64", "256-128-64"),
                ),
                ParamSpec(
                    "alpha", "float", 0.0001, "L2 penalty", 0.0, 1.0, search=(1e-5, 1e-2), log=True
                ),
                ParamSpec(
                    "learning_rate_init",
                    "float",
                    0.001,
                    "Initial learning rate",
                    1e-5,
                    0.1,
                    search=(1e-4, 1e-2),
                    log=True,
                ),
                ParamSpec("max_iter", "int", 300, "Maximum epochs", 10, 5000),
                SEED,
            ),
            build=_mlp,
        ),
    ]
}


def get(key: str) -> Algorithm:
    try:
        return ALGORITHMS[key]
    except KeyError as exc:
        raise ValueError(f"unknown algorithm {key!r}; choose from {sorted(ALGORITHMS)}") from exc


def describe() -> list[dict[str, Any]]:
    out = []
    for algo in sorted(ALGORITHMS.values(), key=lambda a: a.priority):
        out.append(
            {
                "key": algo.key,
                "label": algo.label,
                "family": algo.family,
                "description": algo.description,
                "tags": list(algo.tags),
                "tunable": algo.tunable,
                "params": [
                    {k: v for k, v in asdict(p).items() if k not in ("search", "log")}
                    | {"tunable": p.search is not None}
                    for p in algo.params
                ],
            }
        )
    return out
