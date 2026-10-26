# Common tasks. Run `make help` for the list.
.DEFAULT_GOAL := help
COMPOSE := docker compose

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-20s\033[0m %s\n", $$1, $$2}'

up: ## Build and start the local stack (UI on :3000)
	$(COMPOSE) up --build -d

down: ## Stop the local stack
	$(COMPOSE) down

backfill: ## Pull all sources from 2019-12-01 to today into the warehouse (several minutes)
	$(COMPOSE) exec ml gridml ingest --start 2019-12-01

ingest: ## Incremental update of all sources
	$(COMPOSE) exec ml gridml ingest

train-rf: ## Train the default Random Forest from the command line
	$(COMPOSE) exec ml gridml train --algorithm random_forest

setup: ## Install dev dependencies and git hooks
	cd services/ml && uv sync
	cd services/api && go mod download
	cd web && npm ci
	pre-commit install

lint: ## Lint everything
	cd services/ml && uv run ruff check . && uv run ruff format --check . && uv run mypy
	cd services/api && go vet ./... && test -z "$$(gofmt -l .)"
	cd web && npm run lint && npm run format:check && npm run typecheck
	terraform -chdir=infra/terraform fmt -check -recursive

test: ## Unit tests
	cd services/ml && uv run pytest
	cd services/api && go test ./...

test-integration: ## Python tests against the compose Postgres (needs `make up`)
	cd services/ml && TEST_DATABASE_URL=postgresql://grid:grid@localhost:5432/grid uv run pytest tests/test_integration_db.py

tf-init: ## terraform init with the GCS state bucket (TF_STATE_BUCKET=...)
	terraform -chdir=infra/terraform init -backend-config="bucket=$(TF_STATE_BUCKET)"

tf-plan: ## terraform plan
	terraform -chdir=infra/terraform plan

deploy-images: ## Build and push service images with Cloud Build (PROJECT_ID, REGION, TAG)
	./scripts/deploy-images.sh

.PHONY: help up down backfill ingest train-rf setup lint test test-integration tf-init tf-plan deploy-images
