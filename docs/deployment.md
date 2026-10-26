# Deployment (free tiers)

| Piece | Service | Free-tier fit |
|---|---|---|
| Web UI | Vercel Hobby | Static Vite build, rebuilt on every push |
| Warehouse | Supabase Free | 500 MB Postgres. ~52k hourly rows per zone and a few models use well under 100 MB. Free projects pause after 7 idle days; the daily ingestion keeps it active |
| API gateway | Cloud Run (request-billed, scales to zero) | Well inside the monthly free requests / vCPU-seconds |
| ML service | Cloud Run, 1 vCPU / 2 GiB, max 1 instance, CPU always allocated | Roughly 60 instance-hours a month free. Each instance stays up ~15 min after its last request |
| Model artifacts | Cloud Storage, us-east1 | 5 GB free |
| Images | Artifact Registry | 0.5 GB free; cleanup policy keeps the last 3 versions |
| Builds | Cloud Build | 2,500 build-minutes a month free |
| Daily ingestion | Cloud Scheduler | 3 jobs free; 1 used |
| Secrets | Secret Manager | 6 active versions free; 2 used |

Cloud Run and the bucket need a billing account on the project even though usage stays free.
Set `billing_account_id` to get a budget e-mail alert (default USD 5).

## Prerequisites

- `gcloud` logged in (`gcloud auth application-default login`) with a project you own.
- A Supabase account: create an access token (Account → Access Tokens), note the organization
  slug. `export SUPABASE_ACCESS_TOKEN=...`
- A Vercel account with the GitHub integration installed for this repository; create a token.
  `export VERCEL_API_TOKEN=...`
- Terraform ≥ 1.9.

## Steps

```bash
export PROJECT_ID=my-project
./scripts/bootstrap-state.sh                    # state bucket + terraform init

cd infra/terraform
cp terraform.tfvars.example terraform.tfvars    # set project_id, supabase_organization_id, github_repo

# The images must exist before Cloud Run can start. First create the registry, then push.
terraform apply -target=google_project_service.enabled -target=google_artifact_registry_repository.images
cd ../.. && TAG=$(git rev-parse --short HEAD) ./scripts/deploy-images.sh
cd infra/terraform && terraform apply -var image_tag=$TAG

terraform output -raw admin_token               # paste into the UI's "Admin token" dialog
```

The API runs the SQL migrations on start (`MIGRATE_ON_START=true`). Then trigger the first
backfill from the UI (**Data** → start `2019-12-01` → Run) or:

```bash
curl -X POST "$(terraform output -raw api_url)/api/ingest" \
  -H "Authorization: Bearer $(terraform output -raw admin_token)" \
  -H 'Content-Type: application/json' -d '{"start":"2019-12-01"}'
```

### Supabase connection

Cloud Run has no IPv6 egress and Supabase's direct host is IPv6-only, so the services connect
through the Supavisor pooler in session mode (port 5432). Terraform assumes the host
`aws-0-<region>.pooler.supabase.com`; if the project's **Connect** dialog shows a different host
(e.g. `aws-1-...`), set `supabase_pooler_host`. To use an existing database instead, set
`create_supabase_project = false` and `database_url`.

### Updating

```bash
TAG=$(git rev-parse --short HEAD) ./scripts/deploy-images.sh
terraform -chdir=infra/terraform apply -var image_tag=$TAG
```

The UI redeploys by itself when you push to `main`.

## Security notes

- The warehouse lives in schema `grid`, which Supabase's REST API does not expose.
- The ML service is private: only the API's and the scheduler's service accounts can invoke it.
- Training, ingestion and deleting models require the admin token; reading data and forecasting
  are public.
