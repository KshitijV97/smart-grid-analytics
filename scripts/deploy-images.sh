#!/usr/bin/env bash
# Build the api and ml images with Cloud Build and push them to Artifact Registry.
# Usage: PROJECT_ID=my-project [REGION=us-east1] [TAG=$(git rev-parse --short HEAD)] ./scripts/deploy-images.sh
# Then: terraform -chdir=infra/terraform apply -var image_tag=$TAG
set -euo pipefail
: "${PROJECT_ID:?set PROJECT_ID}"
REGION="${REGION:-us-east1}"
TAG="${TAG:-$(git rev-parse --short HEAD)}"
REGISTRY="${REGION}-docker.pkg.dev/${PROJECT_ID}/smart-grid"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

for svc in api ml; do
  echo "==> ${svc}:${TAG}"
  gcloud builds submit "${ROOT}/services/${svc}" --project "$PROJECT_ID" --region "$REGION" \
    --tag "${REGISTRY}/${svc}:${TAG}"
done
echo "Pushed tag ${TAG}. Next: terraform -chdir=infra/terraform apply -var image_tag=${TAG}"
