# HTTP API

The UI talks only to the Go gateway. All bodies are JSON. Times are ISO 8601. Where a query
parameter accepts a date (`YYYY-MM-DD`), it means midnight in Ottawa (America/Toronto).

**Admin** endpoints require `Authorization: Bearer <ADMIN_TOKEN>` when the gateway has a token
configured. Without a valid token they return `401`.

## Gateway (`services/api`)

| Method & path | Admin | Description |
|---|---|---|
| `GET /healthz` | | `200 {"status":"ok"}`, or `503` if the database is unreachable |
| `GET /api/catalog` | | Algorithms with their hyperparameter schemas, feature groups, zones, default split, ingest sources, scenario defaults |
| `GET /api/data/coverage` | | Row count and first/last timestamp per source |
| `GET /api/data/series?zone=&start=&end=&resolution=` | | Observed demand, temperature, irradiance and Ontario wind/solar. `zone` is `Ottawa` (default) or `Ontario`. Hourly up to ~3 months, daily beyond; `resolution=hour\|day` overrides. Range limits: 6 years, or ~13 months at hourly resolution |
| `GET /api/ingestion-runs?limit=` | | Recent ingestion runs (default 50, max 500) |
| `POST /api/ingest` | ✓ | Start ingestion (see body below). Returns `202` |
| `GET /api/training-runs?limit=` | | Recent training runs with status and log |
| `GET /api/training-runs/{id}` | | One training run |
| `POST /api/training-runs` | ✓ | Start training (see body below). Returns `202 {"run_id", "status"}` |
| `GET /api/models` | | Models with headline validation, test and base-load metrics |
| `GET /api/models/{id}` | | Full model: parameters, features, split, all metric breakdowns, feature importance |
| `GET /api/models/{id}/backtest?split=&start=&end=` | | Hourly actual vs predicted; `split` is `validation` or `test` |
| `DELETE /api/models/{id}` | ✓ | Delete a model and its artifact |
| `GET /api/forecasts?model_id=&limit=` | | Saved forecast summaries |
| `POST /api/forecasts` | | Run a forecast (see body below) |

## Request bodies

### `POST /api/ingest`

```json
{ "sources": ["ieso_demand", "weather_archive"], "start": "2019-12-01", "end": "2026-10-27", "wait": false }
```

- `sources`: any of `ieso_demand`, `ieso_fuel`, `weather_archive`, `weather_forecast`, `eccc`,
  `holidays`. Omit it to run all sources.
- `start`: omit for an incremental run (newest stored hour minus 10 days).
- `end`: defaults to today.
- `wait`: `true` blocks until the run finishes. The scheduler uses this.

### `POST /api/training-runs`

```json
{
  "algorithm": "random_forest",
  "params": { "n_estimators": 300, "max_depth": 24 },
  "target_zone": "Ottawa",
  "horizon_hours": 24,
  "feature_groups": ["calendar", "weather", "solar", "renewables", "load_lags"],
  "split": {
    "train_start": "2020-01-01", "train_end": "2023-12-31",
    "val_start": "2024-01-01", "val_end": "2024-12-31",
    "test_start": "2025-01-01", "test_end": "2025-12-31"
  },
  "search_iterations": 0,
  "refit_on_train_val": true,
  "name": "optional display name"
}
```

- Unknown hyperparameters, out-of-range values, unknown feature groups and overlapping splits
  return `422`.
- `horizon_hours` is 1–168. `search_iterations` is 0–50.

### `POST /api/forecasts`

```json
{
  "model_id": "uuid",
  "start": "2026-10-28T00:00:00",
  "hours": 48,
  "scenario": { "solar_mw_ac": 10, "wind_mw": 20, "ev_count": 300 },
  "save": true
}
```

- `start`: local time. Omit it to start right after the newest observed hour.
- `hours`: 1–336.
- `scenario`: optional; unspecified fields take the defaults listed in
  [methodology.md §7](methodology.md#7-scenario-layer-scenariopy).

The response has the following fields:

- `points`: hourly records with `predicted_mw`, `lower_mw` and `upper_mw` (80 % band),
  `actual_mw` (when known), `baseload_mw`, `variable_mw`, `temperature_c`, `weather`
  (`weather` or `climatology`), and, with a scenario, `solar_mw`, `wind_mw`, `ev_mw` and
  `net_load_mw`;
- `daily`: peak, peak hour, base load, mean, energy and variable energy, actual peak and base
  where known, and net peak and base with a scenario;
- `accuracy`: metrics over the hours that have actual demand, otherwise `null`;
- `notes`: caveats such as recursion, climatology weather, or bridging a data gap.

Errors: `404` for an unknown model, `422` when data is missing (for example, no demand data
before the start, or a gap of more than 14 days).

## ML service (`services/ml`, internal)

Not exposed publicly in the cloud. Endpoints: `GET /healthz`, `GET /catalog`, `POST /ingest`,
`POST /train`, `POST /forecast`, `DELETE /models/{id}`. FastAPI serves interactive docs at
`http://localhost:8000/docs` when run locally.

## Command line

```bash
gridml ingest [--sources ...] [--start YYYY-MM-DD] [--end YYYY-MM-DD]
gridml train --algorithm random_forest --zone Ottawa --horizon 24 --params '{"n_estimators":500}' --search 10
gridml serve --port 8000
api migrate      # Go binary: apply SQL migrations and exit
```
