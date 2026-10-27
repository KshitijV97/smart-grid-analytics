# Architecture

## Components

```
          ┌─────────── Vercel (static UI) ───────────┐
browser ─▶│ React + TanStack + daisyUI + nivo        │
          └───────────────┬──────────────────────────┘
                          │ /api/*
                ┌─────────▼─────────┐   ID token   ┌──────────────────────────┐
                │ Go API (Cloud Run)├─────────────▶│ Python ML (Cloud Run)    │
                │ reads warehouse   │  train/      │ ingest · train · forecast│
                └─────────┬─────────┘  forecast    └──────┬───────────┬───────┘
                          │                               │           │ joblib
                ┌─────────▼───────────────────────────────▼─┐   ┌─────▼──────┐
                │ Postgres warehouse (Supabase), schema grid │   │ GCS bucket │
                └────────────────────────────────────────────┘   └────────────┘
  Cloud Scheduler ──(daily, OIDC)──▶ ML /ingest ──▶ IESO · Open-Meteo · ECCC
```

| Component | Path | Technology | Responsibility |
|---|---|---|---|
| Web UI | `web/` | React 19, TypeScript, TanStack Router and Query, Tailwind CSS 4 + daisyUI 5, nivo | Data overview, ingestion trigger, training form, model comparison, forecasts |
| API gateway | `services/api/` | Go (standard library `net/http`, pgx) | Public HTTP API, warehouse reads, admin-token checks, CORS, schema migrations, proxy to the ML service |
| ML service | `services/ml/` | Python 3.12, FastAPI, scikit-learn [24], XGBoost [10], pandas [26], NumPy [25], pvlib [8] | Ingestion connectors, feature engineering, training, forecasting, scenario layer |
| Warehouse | `services/api/internal/db/migrations/` | PostgreSQL 16 (Supabase in the cloud) | Raw sources, training runs, models, back-tests, saved forecasts |
| Model store | `services/ml/src/gridml/artifacts.py` | Local directory or Google Cloud Storage | Compressed joblib model bundles |
| Infrastructure | `infra/terraform/` | Terraform | Cloud Run, Artifact Registry, GCS, Secret Manager, Cloud Scheduler, Supabase, Vercel |

### Why two backend services

The ML stack (scikit-learn, XGBoost, pvlib) lives in Python. The gateway is a small Go binary
that starts in milliseconds and scales to zero. This keeps the always-public surface cheap and
lets the heavier ML container stay private, run as a single instance, and spin up only for
training, forecasting and ingestion.

## Request flows

**Training.**

1. The UI sends `POST /api/training-runs` to the gateway, which checks the admin token and
   forwards the request to ML `POST /train`.
2. The ML service validates the request, inserts a `training_runs` row with status `queued`,
   and returns `202` with the run ID.
3. A single-worker thread pool loads data, trains, saves the artifact, and inserts the
   `models` and `model_backtest` rows. It updates the run's `status` and `log` as it goes.
4. The UI polls `GET /api/training-runs` every 2 s while any run is queued or running.

**Forecasting.**

1. The UI sends `POST /api/forecasts`; the gateway forwards it to ML `POST /forecast`.
2. The ML service loads the bundle (an in-memory cache holds the last 3 models), loads history
   and weather, runs the recursive forecast, saves a summary in `forecasts`, and returns the
   hourly points and daily summary.

**Ingestion.** Cloud Scheduler (or the local `scheduler` container) calls ML `POST /ingest` with
`{"wait": true}`. Each source writes an `ingestion_runs` row and upserts its rows, so re-running
is safe.

On start-up the ML service marks any `queued` or `running` training and ingestion runs as
`failed` ("interrupted by restart"), because their threads did not survive.

## Warehouse schema (`grid`)

| Table | Key | Content |
|---|---|---|
| `ieso_zonal_demand` | `ts_utc, zone` | Hourly MW per IESO zone; `Ontario` holds the province total |
| `ieso_generation_fuel` | `ts_utc, fuel` | Hourly MW per fuel type (Ontario, transmission-connected) |
| `weather_hourly` | `ts_utc, location, source` | Weather variables; `source` is `era5`, `forecast` or `eccc` |
| `holidays` | `day, region` | Ontario holidays |
| `ingestion_runs` | `id` | One row per source per run: status, row count, range, error |
| `training_runs` | `id` (UUID) | Request JSON, status, progress log, error, resulting model |
| `models` | `id` (UUID) | Algorithm, zone, horizon, final hyperparameters, feature list, split, metrics, feature importance, residual quantiles, artifact URI |
| `model_backtest` | `model_id, ts_utc` | Hourly actual vs predicted on the validation and test years |
| `forecasts` | `id` (UUID) | Forecast requests and daily summaries |
| `schema_migrations` | `version` | Applied migration files |

Notes:

- All tables live in the `grid` schema, which Supabase's auto-generated REST API (PostgREST)
  does not expose by default.
- Timestamps are UTC (see [data-sources.md](data-sources.md#time-conventions)).
- Migrations are plain SQL files embedded in the Go binary and applied in file-name order by
  `api migrate`, or on start-up with `MIGRATE_ON_START=true`.

## Model artifact

`artifacts.save` writes a joblib bundle (compression level 3) containing:

- `model`: the fitted scikit-learn or XGBoost estimator or pipeline;
- `feature_columns` and `feature_config` (horizon and feature groups), so forecasting rebuilds
  exactly the training features;
- `params`, `algorithm`, `target_zone`;
- `residual_quantiles`: validation residual quantiles by local hour, for prediction bands.

`ARTIFACT_STORE` selects the backend: `file:///data/models` locally, or
`gs://<bucket>/models` on Google Cloud.

## Security model

- Mutating gateway endpoints (ingest, train, delete) require `Authorization: Bearer
  <ADMIN_TOKEN>` when `ADMIN_TOKEN` is set. The token is compared in constant time. Locally it
  is empty, so these endpoints are open.
- Reads and forecasts are public.
- On Cloud Run the ML service has no public invoker. The gateway calls it with a Google-signed
  ID token from the metadata server, and the scheduler uses an OIDC token.
- CORS allows only the origins in `ALLOWED_ORIGINS`.
- On Google Cloud, the database URL and the admin token reach the containers from Secret
  Manager, never as plain environment values.

## Configuration

| Variable | Service | Default | Meaning |
|---|---|---|---|
| `DATABASE_URL` | api, ml | local Postgres | Warehouse connection string |
| `ML_URL` | api | `http://localhost:8000` | ML service base URL |
| `ML_AUDIENCE` | api | empty | When set, attach a Google ID token for this audience |
| `ADMIN_TOKEN` | api | empty | Required bearer token for mutating endpoints |
| `ALLOWED_ORIGINS` | api | `http://localhost:5173,http://localhost:3000` | CORS allow-list (`*` allowed) |
| `MIGRATE_ON_START` | api | `false` | Apply migrations before serving |
| `PORT` | api, ml | 8080 / 8000 | Listen port |
| `ARTIFACT_STORE` | ml | `file:///tmp/gridml-models` | Model store URI |
| `BACKFILL_START` | ml | `2019-12-01` | Earliest date for a first ingestion |
| `VITE_API_BASE_URL` | web (build time) | empty (same origin) | Gateway URL when the UI is hosted separately |
