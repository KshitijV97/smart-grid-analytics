# smart-grid-analytics

Course project for ELG 5255 (Applied Machine Learning), University of Ottawa, Fall 2026. Topic area: smart grid.

## Stay on scope
Before planning or making significant changes, read `docs/project-overview.md` (summary of the official brief at `docs/Project_Overview.pdf`). Check that the work serves the deliverables and evaluation criteria listed there:
- At least one applied ML algorithm implemented for a smart grid problem (load forecasting, renewable generation forecasting, or anomaly detection).
- If the work reproduces a paper, that paper must be ACM/IEEE indexed.
- Results must support critical performance analysis for an IEEE-format report (at least 5 pages) and a 10-minute final presentation.

If a request seems to drift away from these requirements, say so before proceeding.

## Chosen project (Phase 1, Oct 2026)
Hourly electricity load forecasting for the **Ottawa zone** (IESO zonal demand), plus next-day baseload (daily minimum hourly load).
- Graded ML core, on real data: IESO demand, ECCC / Open-Meteo weather, Ontario holidays → Linear Regression baseline vs Random Forest vs XGBoost (LSTM is a stretch goal). Chronological split: train 2020–2023, validate 2024, test 2025. Metrics: MAE, RMSE, MAPE, R².
- Scenario layer, using stated assumptions: net load = demand − solar farm (pvlib) − wind farm (power curve) + EV fleet charging, with residential/industrial profiles. It must not block the core deliverable.
- Team: Kshitij and Victor. Phase 1 deck: `presentation/` (built by `build_deck.js`). Phase 1 rubric: `docs/Phase_1_Rubric.pdf`.
- Literature and Q&A prep: `presentation/STUDY_NOTES.md` (paper cheat-sheet with verified numbers; `phone_notes.txt` is a plain-text copy for the phone). Only cite numbers verified against the paper itself; Rawal & Ahmad [2] numbers are unverified.

## Codebase (Phase 2 implementation)
See `README.md` for the architecture and `docs/deployment.md` for the free-tier deployment.
- `services/ml/` (Python, uv): ingestion connectors, warehouse loader, features, algorithm registry, training, forecasting, scenario layer, FastAPI. Tests: `uv run pytest` (set `TEST_DATABASE_URL` for the Postgres integration test). Lint: `uv run ruff check . && uv run mypy`.
- `services/api/` (Go): gateway, SQL migrations in `internal/db/migrations/` (`go run ./cmd/api migrate`). Tests: `go test ./...`.
- `web/` (React/TS, TanStack, daisyUI, nivo): `npm run lint && npm run build`.
- `infra/terraform/`: GCP Cloud Run + GCS + Scheduler, Supabase, Vercel.
- Test fixtures and `tests/conftest.py` use synthetic data for code paths only; never report numbers from them.
