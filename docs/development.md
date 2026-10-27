# Development

## Prerequisites

| Tool | Version | Used for |
|---|---|---|
| Docker with Compose | recent | Local stack |
| Python + [uv](https://docs.astral.sh/uv/) | 3.12+ | ML service |
| Go | 1.25+ | API gateway |
| Node.js | 22 | Web UI |
| Terraform, tflint | ≥ 1.9 | Infrastructure |
| pre-commit | recent | Git hooks |
| golangci-lint | v2 | Go lint hook |

`make setup` installs the language dependencies and the git hooks.

## Running

```bash
make up                          # everything in Docker; UI on :3000, API on :8080, ML on :8000
make backfill                    # first data load
```

Running services individually against the Compose database:

```bash
docker compose up -d db migrate
cd services/ml  && DATABASE_URL=postgresql://grid:grid@localhost:5432/grid uv run uvicorn gridml.api:app --reload
cd services/api && DATABASE_URL=postgres://grid:grid@localhost:5432/grid go run ./cmd/api
cd web          && npm run dev   # proxies /api to :8080
```

## Tests

| Command | What it covers |
|---|---|
| `cd services/ml && uv run pytest` | Parsers for every source (fixtures in `tests/fixtures/`), feature leakage and calendar handling, every algorithm, XGBoost early stopping, random search, recursive forecasting, gap bridging, scenario arithmetic |
| `make test-integration` | Same suite plus `test_integration_db.py`: warehouse → train → forecast against a real Postgres (`TEST_DATABASE_URL`) |
| `cd services/api && go test ./...` | Admin-token guard, request proxying, CORS allow-list, 404 handling, series resolution rules |
| `cd web && npm run build` | Type-checks and bundles the UI |

The fixtures and `tests/conftest.py` use **synthetic** data, so that code paths can be checked
without network access. Never report numbers from them.

## Lint and format

| Language | Tools | Config |
|---|---|---|
| Python | ruff (lint + format), mypy (strict defs, pydantic plugin) | `services/ml/pyproject.toml` |
| Go | gofmt, go vet, golangci-lint v2 | `services/api/.golangci.yml` |
| TypeScript | ESLint (typescript-eslint, react-hooks), Prettier (+ Tailwind plugin), `tsc` strict | `web/eslint.config.js`, `web/.prettierrc.json`, `web/tsconfig.app.json` |
| Terraform | `terraform fmt`, `terraform validate`, tflint (terraform + google rulesets) | `infra/terraform/.tflint.hcl` |
| Dockerfiles | hadolint | `.pre-commit-config.yaml` |
| Secrets | gitleaks | `.pre-commit-config.yaml` |

`make lint` runs the language checks. `pre-commit run --all-files` runs every hook.
`.editorconfig` sets whitespace rules.

## Continuous integration

`.github/workflows/ci.yml` runs on pushes to `main` and on pull requests:

- **ml**: ruff, mypy, migrations against a Postgres service container, then pytest including the
  integration test.
- **api**: golangci-lint and `go test -race`.
- **web**: ESLint, Prettier check, build.
- **terraform**: `fmt -check`, `init -backend=false`, `validate`, tflint.
- **docker**: `docker compose build`.

## Extending

- **New algorithm:** add an `Algorithm` entry to `ALGORITHMS` in
  `services/ml/src/gridml/algorithms.py`, with a `build` function and `ParamSpec`s. The UI picks
  it up from `/api/catalog`. Give it a colour in `web/src/lib/format.ts` (`ALGO_COLORS`).
- **New data source:** write a parser and fetcher under `services/ml/src/gridml/ingest/`,
  register it in `runner.SOURCES`, `_JOBS` and (if incremental) `_WATERMARK_SQL`, and add a
  table in a new migration file `services/api/internal/db/migrations/000N_*.sql`.
- **New feature:** add it to a group function in `features.py`. Keep lags of anything unknown
  at forecast time at least `horizon_hours`.
- **Schema change:** never edit an applied migration; add a new numbered file.
