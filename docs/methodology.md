# Methodology

This document explains the machine-learning design: the problem, features, data split,
algorithms, metrics, forecasting procedure and the scenario layer. Reference numbers point to
[references.md](references.md). Code paths are relative to `services/ml/src/gridml/`.

## 1. Problem statement

**Target.** Hourly electricity demand $L_t$ (MW) of the IESO **Ottawa** zone [5]. The same
pipeline also runs on the Ontario total.

**Derived quantities** for each local calendar day $d$:

- **Base load:** the minimum hourly load of the day, $B_d = \min_{t \in d} L_t$.
- **Variable load:** the part above it, $V_t = L_t - B_d$.

Base load approximates the always-on demand that steady generation (in Ontario mostly nuclear
and hydro) has to cover. Variable load is what intermediate and peaking plants follow.

**Research question** (from Phase 1). Can tree ensembles, Random Forest [9] and XGBoost [10],
forecast Ottawa's hourly demand and next-day base load more accurately than a Linear Regression
baseline, using lagged demand, weather and calendar features?

**Reference implementation.** Gökçe and Duman [1] (IEEE) compared linear regression, Random
Forest and XGBoost on Turkey's national hourly demand with calendar, holiday, temperature and
24 h lag features. This project follows that design and extends it to:

- a city zone instead of a country;
- weekly and longer lags, which [3] found to be among the strongest predictors;
- a base-load target;
- a strictly chronological validation scheme;
- a net-load scenario layer.

## 2. Features (`features.py`)

Features are built on a continuous hourly UTC index and grouped so that each group can be
switched on or off in the UI. Switching groups off is the basis for ablation studies in the
report.

| Group | Features | Rationale |
|---|---|---|
| `calendar` | hour, weekday, month, day of year; weekend, holiday, workday and "next to a holiday" flags; sine/cosine of hour and day of year; daylight-saving flag; COVID-19 lockdown flag (15 Mar 2020 – 30 Jun 2021) | Daily, weekly and seasonal cycles; holidays behave like weekends [1], [27] |
| `weather` | temperature, apparent temperature, dew point, humidity, precipitation, snowfall, cloud cover, wind at 10 m and 100 m; heating and cooling degree-hours (base 18 °C); 24 h mean, minimum and maximum temperature; 3 h temperature change; heating degree-hours × wind speed | Heating and cooling load; thermal inertia of buildings; wind chill [27] |
| `solar` | sun elevation (pvlib ephemeris [8]); clear-sky irradiance (Haurwitz [21]); clear-sky index; global, direct and diffuse irradiance; embedded-PV capacity factor | Daylight affects lighting load. Rooftop solar is invisible to IESO and lowers measured midday demand |
| `renewables` | Ontario wind and solar output [11], lagged by the horizon $H$ and by 168 h | Proxy for system conditions. Only lagged values are used because future output is unknown |
| `load_lags` | $L_{t-k}$ for $k \in \{1, 2, 3, 24, 48, 72, 168, 336\}$ with $k \ge H$; mean, minimum and maximum of the 24 h ending at $t-H$; mean of the 168 h ending at $t-H$ | Persistence and daily/weekly cycles; previous-day and previous-week load were top predictors in [3] |

**Degree-hours.** $\text{HDH}_t = \max(18 - T_t, 0)$ and $\text{CDH}_t = \max(T_t - 18, 0)$, with
$T_t$ in °C. These turn the U-shaped temperature–load relation into two monotone terms that
linear models can use.

**Embedded-PV proxy.** A PVWatts-style [23] capacity factor computed from global irradiance $G$
(W/m²) and an estimated cell temperature:

$$T_c = T + \frac{G}{800} \cdot 20, \qquad
\text{CF} = \operatorname{clip}\!\left(\frac{G}{1000}\,\bigl(1 - 0.004\,(T_c - 25)\bigr),\ 0,\ 1\right).$$

**No leakage by construction.** Load and generation lags are only used at lags $\ge H$, the
model's forecast horizon. A model with $H = 24$ never sees load from the 23 hours before the
hour it predicts. A unit test (`tests/test_features.py`) changes those 23 hours and checks that
the features do not change. Weather at hour $t$ is used directly: in back-tests it is the
observed value, in live forecasts the weather forecast (see
[data-sources.md](data-sources.md#why-reanalysis-for-training-and-forecasts-for-prediction)).

## 3. Data split and validation (`training.py`)

Time series are autocorrelated, so random K-fold splits put near-copies of test hours into
training and overstate accuracy [29], [30]. The split is therefore **chronological** and uses
local calendar dates:

| Period | Default dates | Used for |
|---|---|---|
| Train | 2020-01-01 – 2023-12-31 | Fitting |
| Validation | 2024-01-01 – 2024-12-31 | Hyperparameter search, XGBoost early stopping, prediction-interval calibration |
| Test | 2025-01-01 – 2025-12-31 | Scored once, for the report |

- 21 days of history before the training start are loaded so that the 336 h lag exists. Rows
  with fewer than 90 % of features available (the warm-up period) are dropped.
- **Refit (optional, on by default).** After tuning, the model is refit on train + validation
  and that refit model is scored on the test year and used for live forecasts. Validation
  metrics always come from the model fit on the training years only. For XGBoost, the refit
  uses the number of boosting rounds selected by early stopping.
- The split dates are editable in the UI, so the report can also show, for example, the effect
  of excluding 2020.

## 4. Algorithms (`algorithms.py`)

| Key | Algorithm | Role | Notes |
|---|---|---|---|
| `random_forest` | Random Forest [9] | **Primary** | Bagged deep trees with random feature subsets. Default 300 trees, depth 24, `max_features` 0.5, `max_samples` 0.8 |
| `xgboost` | XGBoost [10] | **Secondary** | Regularised gradient boosting [16]. Learning rate 0.03, depth 7, up to 3,000 rounds, early stopping after 150 rounds without validation improvement |
| `hist_gradient_boosting` | scikit-learn histogram GBM [24] | Comparison | LightGBM-style binned boosting [18] |
| `extra_trees` | Extremely randomized trees [17] | Comparison | Random split thresholds |
| `linear_regression` | Ordinary least squares | **Baseline** | One-hot hour, weekday and month; median imputation; standardised numeric features |
| `ridge` | Ridge regression [31] | Baseline | L2-regularised linear model |
| `mlp` | Multilayer perceptron [24] | Comparison | Stand-in for the LSTM stretch goal [4]; standardised inputs and target |

Every algorithm declares its hyperparameters (type, default, bounds and an optional search
range) in one place. The UI renders its training form from that declaration, so adding an
algorithm to the registry makes it selectable end to end.

**Hyperparameter search.** Optional random search [19]: $n$ configurations are sampled from the
declared ranges (log-uniform for scale parameters such as learning rate). The one with the
lowest validation MAE is kept. The test year is never used for selection.

**Feature importance.** Tree models report impurity-based importances [9], [10]. Other models
use permutation importance on up to 2,000 validation rows (MAE scoring, 3 repeats). Importances
are normalised to sum to 1. Impurity-based importances can be biased towards continuous
features with many possible split points, so the report should interpret them alongside the
feature-group ablations rather than on their own.

## 5. Metrics (`metrics.py`)

For actual values $y_t$ and forecasts $\hat y_t$ over $n$ hours:

$$\text{MAE} = \frac1n\sum_t |\hat y_t - y_t|, \qquad
\text{RMSE} = \sqrt{\frac1n\sum_t (\hat y_t - y_t)^2},$$

$$\text{MAPE} = \frac{100}{n}\sum_t \left|\frac{\hat y_t - y_t}{y_t}\right|, \qquad
R^2 = 1 - \frac{\sum_t (y_t - \hat y_t)^2}{\sum_t (y_t - \bar y)^2}, \qquad
\text{bias} = \frac1n\sum_t (\hat y_t - y_t).$$

- MAE is the typical error in MW. RMSE weights large misses more heavily, which matters at
  peaks.
- MAPE allows comparison with other grids, but it is undefined at zero and asymmetric [28].
  Zonal demand is always far from zero, so it is safe here.
- $R^2$ shows the share of variance explained.

**Breakdowns** for critical analysis, on the validation and test years:

- by season (winter Dec–Feb, spring Mar–May, summer Jun–Aug, fall Sep–Nov);
- on-peak (workdays 07:00–23:00 local) versus off-peak;
- holidays versus other days;
- MAE by local hour of day;
- **daily base load** (daily minimum of predictions vs actuals) and daily peak, computed on
  complete days only.

**Seasonal-naive reference.** "Same hour last week" ($\hat y_t = y_{t-168}$) is scored on the
same hours. A model that does not beat it adds no value [30].

## 6. Forecasting (`forecasting.py`)

1. Load the model artifact and at least 30 days of history before the start.
2. **Weather** for each forecast hour comes from the warehouse: observed where available,
   otherwise the Open-Meteo forecast [12]. Beyond the 16-day forecast it falls back to
   **climatology**: the mean reanalysis value for that day of year and hour. The response lists
   how many hours used climatology.
3. **Recursion.** A model with horizon $H$ predicts $H$ hours at once. For longer windows, each
   block's predictions are written back into the series and feed the lags of the next block.
   If the latest observed load is earlier than the requested start (up to 14 days), the gap is
   forecast first. Errors compound with lead time, as [3] also found for multi-step forecasts.
4. **Prediction band.** The 10th and 90th percentiles of validation residuals for each local
   hour are added to the forecast, giving an empirical 80 % band. This is a simple form of the
   interval forecasting discussed in [27]. It is calibrated for the model's own horizon and
   underestimates uncertainty in recursive hours.
5. **Base and variable load** are derived per local day: $\hat B_d = \min_{t\in d}\hat L_t$
   and $\hat V_t = \hat L_t - \hat B_d$. A partial first or last day has a base load computed
   over the hours it contains.
6. If actual demand exists for the window (a back-test), the response also includes MAE, RMSE,
   MAPE and $R^2$ for that window.

## 7. Scenario layer (`scenario.py`)

The scenario layer uses stated assumptions, not data, and the graded core does not depend on
it. Every parameter is adjustable in the UI. The defaults below are the Phase 1 assumptions.

$$\text{NetLoad}_t = \hat L_t - P^{\text{solar}}_t - P^{\text{wind}}_t + P^{\text{EV}}_t$$

**Solar farm** (default 10 MW AC, DC/AC ratio 1.2, 30° tilt facing south, sited in Ottawa).
The model is a PVWatts-style chain built with pvlib [8], [23]:

- Erbs decomposition of global irradiance into direct and diffuse components [20];
- transposition to the tilted plane of the array;
- Faiman cell-temperature model [22];
- PVWatts DC power with a −0.4 %/°C temperature coefficient and 14 % system losses;
- 96 % inverter efficiency, clipped at the AC rating.

**Wind farm** (default 20 MW). A cubic power curve on the 100 m wind speed $v$ (m/s), with
cut-in $v_{ci} = 3$, rated speed $v_r = 12$ and cut-out $v_{co} = 25$:

$$P^{\text{wind}} = P_r \cdot
\begin{cases}
0 & v < v_{ci} \text{ or } v > v_{co} \\
\dfrac{v^3 - v_{ci}^3}{v_r^3 - v_{ci}^3} & v_{ci} \le v < v_r \\
1 & v_r \le v \le v_{co}
\end{cases}$$

The cube follows from the kinetic power of wind, $\tfrac12 \rho A v^3$.

**EV fleet** (default 300 vehicles, 60 kWh per vehicle per workday, 7.5 kW chargers, charging
from 22:00):

- Each night the fleet charges at full power until the energy needed for the next day is
  delivered.
- Before a weekend or holiday, the energy is scaled by 0.3.
- The fleet is treated as **new** load, which is why it is added.

The Phase 1 plan also mentions residential and industrial load profiles. They are not
implemented yet; see [Limitations](#8-assumptions-and-limitations).

## 8. Assumptions and limitations

- **Ex-post weather.** Back-tests use observed weather, so live accuracy will be lower
  ([data-sources.md](data-sources.md#why-reanalysis-for-training-and-forecasts-for-prediction)).
- **Recursive horizon.** Forecasts beyond the model's horizon reuse predictions as lags, so
  errors compound. The 80 % band does not widen to reflect this.
- **Base-load definition.** The daily minimum of hourly load is a practical proxy. It is not an
  operational definition of must-run generation.
- **Embedded generation.** Rooftop solar is only captured indirectly, through irradiance
  features.
- **Weather blend for Ontario.** The location weights are approximate.
- **Scenario layer.** All plant and fleet sizes are hypothetical. The residential/industrial
  split from the Phase 1 plan is not implemented yet.
- **COVID-19.** 2020–2021 demand patterns are unusual. The `covid_lockdown` flag and an editable
  split support a with/without-2020 comparison.
- **No results yet.** At the time of writing, models have only been trained on synthetic test
  fixtures to exercise the code. No accuracy numbers from those runs should be reported.
