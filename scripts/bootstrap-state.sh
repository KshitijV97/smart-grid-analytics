#!/usr/bin/env bash
# One-time: create the GCS bucket that holds Terraform state, then init.
# Usage: PROJECT_ID=my-project ./scripts/bootstrap-state.sh
set -euo pipefail
: "${PROJECT_ID:?set PROJECT_ID}"
REGION="${REGION:-us-east1}"
BUCKET="${TF_STATE_BUCKET:-${PROJECT_ID}-tfstate}"

gcloud services enable storage.googleapis.com --project "$PROJECT_ID"
if ! gcloud storage buckets describe "gs://${BUCKET}" --project "$PROJECT_ID" >/dev/null 2>&1; then
  gcloud storage buckets create "gs://${BUCKET}" --project "$PROJECT_ID" \
    --location "$REGION" --uniform-bucket-level-access --public-access-prevention
  gcloud storage buckets update "gs://${BUCKET}" --versioning
fi
terraform -chdir="$(dirname "$0")/../infra/terraform" init -backend-config="bucket=${BUCKET}"
echo "State bucket: gs://${BUCKET}"
