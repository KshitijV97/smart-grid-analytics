# smart-grid-analytics

Hourly electricity load forecasting for the **Ottawa zone** (and Ontario as a whole), with
next-day **base load** (daily minimum) and **variable load** (everything above it). Course
project for ELG 5255 Applied Machine Learning, University of Ottawa, Fall 2026.

- **Data warehouse** (Postgres): IESO demand and fuel-mix output, Open-Meteo weather history and
  forecasts, Environment Canada station data, Ontario holidays. Refreshed daily.
- **ML service** (Python): feature engineering, training with a chronological
  train / validation / test split, Random Forest (primary), XGBoost (secondary) plus baselines,
  recursive forecasting, and a solar / wind / EV scenario layer.
- **API gateway** (Go) and **web UI** (React + TypeScript, TanStack Router/Query, Tailwind +
  daisyUI, nivo charts): pick an algorithm and its hyperparameters, train, compare models, and
  forecast with any trained model.
- Runs locally with **Docker Compose**; deploys on free tiers of **Google Cloud Run**,
  **Supabase** and **Vercel** with **Terraform**.

```
          ┌─────────── Vercel (static UI) ───────────┐
browser ─▶│ React + TanStack + daisyUI + nivo        │
          └───────────────┬──────────────────────────┘
                          │ /api/*
                ┌─────────▼─────────┐   ID token   ┌─────────────────────────┐
                │ Go API (Cloud Run)├─────────────▶│ Python ML (Cloud Run)   │
                │ reads warehouse   │  train/      │ ingest · train · forecast│
                └─────────┬─────────┘  forecast    └──────┬───────────┬──────┘
                          │                               │           │ joblib
                ┌─────────▼───────────────────────────────▼─┐   ┌─────▼──────┐
                │ Postgres warehouse (Supabase), schema grid │   │ GCS bucket │
                └────────────────────────────────────────────┘   └────────────┘
  Cloud Scheduler ──(daily, OIDC)──▶ ML /ingest ──▶ IESO · Open-Meteo · ECCC
```

## Quick start (local)

Requirements: Docker with Compose.

```bash
make up          # db, migrations, ml, api, web, scheduler; UI at http://localhost:3000
make backfill    # pull 2019-12-01 → today from every source (several minutes)
```

Then in the UI: **Train** → Random Forest → *Train*. When the run succeeds, open **Models** to
compare and **Forecast** to predict demand, base load and variable load.

Developing without Docker: run Postgres, then

```bash
cd services/api && DATABASE_URL=postgres://... go run ./cmd/api migrate && go run ./cmd/api
cd services/ml  && uv sync && DATABASE_URL=postgresql://... uv run uvicorn gridml.api:app --port 8000
cd web          && npm ci && npm run dev      # http://localhost:5173, proxies /api to :8080
```

## Data sources

All free and public; no API keys. Times are stored in UTC (IESO reports use EST hour-ending all
year, ECCC uses local standard time; both are converted on ingest).

| Source | What | Used for |
|---|---|---|
| IESO Hourly Zonal Demand (`PUB_DemandZonal_YYYY.csv`) | MW per zone, incl. Ottawa and Ontario total | Target, load lags |
| IESO Generator Output by Fuel (`PUB_GenOutputbyFuelHourly_YYYY.xml`) | Ontario wind, solar, hydro, nuclear, gas MW | Lagged renewable features, Overview charts |
| Open-Meteo historical (ERA5) | Temperature, dew point, humidity, apparent temp., precipitation, snowfall, cloud, wind 10 m / 100 m, global / direct / diffuse irradiance | Weather and solar features (training) |
| Open-Meteo forecast | Same variables, 16 days ahead | Weather for live forecasts |
| ECCC Ottawa Intl A (station 49568) | Station temperature, humidity, wind | Cross-checking the reanalysis |
| `holidays` package (CA-ON) | Statutory holidays + Civic Holiday | Calendar features |

Weather points: Ottawa for the Ottawa zone; a population-weighted blend of Toronto, Ottawa,
London and Sudbury for Ontario. Beyond the 16-day weather forecast, forecasts fall back to
climatology (average weather for that day and hour) and say so.

## Machine learning

- **Target:** hourly zonal demand (MW). **Base load** = that day's minimum hourly load;
  **variable load** = hourly load − base load.
- **Features** (selectable groups): calendar (hour, weekday, month, holidays, DST, COVID
  lockdown), weather (incl. heating / cooling degree-hours, 24 h temperature stats, wind chill),
  solar (sun elevation, clear-sky index, embedded-PV proxy for rooftop solar invisible to IESO),
  renewables (lagged IESO wind/solar), and load lags (≥ horizon only, so nothing leaks).
- **Split:** chronological, defaults train 2020–2023, validate 2024, test 2025.
  Hyperparameter search and XGBoost early stopping use the validation year only; the test year
  is scored once. Optionally refit on train + validation before scoring test and forecasting.
- **Algorithms:** Random Forest (primary), XGBoost (secondary), Histogram Gradient Boosting,
  Extra Trees, Linear Regression (baseline), Ridge, MLP. Add one in
  `services/ml/src/gridml/algorithms.py` and it appears in the UI.
- **Metrics:** MAE, RMSE, MAPE, R², bias — overall and by season, on/off-peak, holidays, hour of
  day, plus daily base-load and daily-peak accuracy, and a seasonal-naive ("same hour last
  week") reference, for the critical analysis in the report.
- **Forecasting:** a model with horizon *H* predicts *H* hours at once; longer windows are
  recursive. 80 % bands come from validation residuals by hour of day.
- **Scenario layer** (optional): net load = demand − solar farm (pvlib PVWatts chain) − wind farm
  (cubic power curve on 100 m wind) + EV fleet charging. Every assumption is a parameter.

## Deploying (free tiers)

See [`docs/deployment.md`](docs/deployment.md). In short:

```bash
PROJECT_ID=my-project ./scripts/bootstrap-state.sh     # GCS bucket for Terraform state
PROJECT_ID=my-project ./scripts/deploy-images.sh       # Cloud Build → Artifact Registry
cd infra/terraform && cp terraform.tfvars.example terraform.tfvars  # edit
terraform apply -var image_tag=<tag>
```

## Code quality

`make setup` installs dependencies and the git hooks; `pre-commit run --all-files` runs
ruff + mypy (Python), golangci-lint (Go), ESLint + Prettier + tsc (web), terraform fmt / validate
/ tflint, hadolint and gitleaks. CI (`.github/workflows/ci.yml`) runs the same checks, the
unit tests and a Postgres-backed integration test.

## Layout

```
services/ml/     Python: ingestion, features, training, forecasting, scenario (FastAPI)
services/api/    Go: HTTP gateway, warehouse queries, SQL migrations
web/             React UI
infra/terraform/ GCP (Cloud Run, GCS, Scheduler, Secret Manager), Supabase, Vercel
docs/            Course brief, rubric, papers, deployment guide
presentation/    Phase 1 deck and study notes
```
