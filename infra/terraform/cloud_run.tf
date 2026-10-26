# Python ML service: private, invoked only by the API and the scheduler.
# CPU stays allocated while an instance is up so background training threads
# keep running after the HTTP response; one instance bounds cost and memory.
# 1 vCPU / 2 GiB gives roughly 60 instance-hours a month inside the free tier.
module "ml" {
  source = "./modules/cloud_run_service"

  name                  = "${local.name}-ml"
  region                = var.region
  image                 = "${local.registry}/ml:${var.image_tag}"
  service_account_email = google_service_account.ml.email
  cpu                   = "1"
  memory                = "2Gi"
  cpu_idle              = false
  max_instances         = 1
  timeout_seconds       = 3600
  port                  = 8000
  env = {
    ARTIFACT_STORE = "gs://${google_storage_bucket.models.name}/models"
  }
  secret_env = {
    DATABASE_URL = google_secret_manager_secret.this["database-url"].secret_id
  }
  invokers = [
    "serviceAccount:${google_service_account.api.email}",
    "serviceAccount:${google_service_account.scheduler.email}",
  ]

  depends_on = [google_secret_manager_secret_version.this, google_secret_manager_secret_iam_member.ml_db]
}

# Go API gateway: public, scales to zero.
module "api" {
  source = "./modules/cloud_run_service"

  name                  = "${local.name}-api"
  region                = var.region
  image                 = "${local.registry}/api:${var.image_tag}"
  service_account_email = google_service_account.api.email
  cpu                   = "1"
  memory                = "512Mi"
  cpu_idle              = true
  max_instances         = 2
  timeout_seconds       = 300
  port                  = 8080
  env = {
    ML_URL           = module.ml.uri
    ML_AUDIENCE      = module.ml.uri
    ALLOWED_ORIGINS  = join(",", local.allowed_origins)
    MIGRATE_ON_START = "true"
  }
  secret_env = {
    DATABASE_URL = google_secret_manager_secret.this["database-url"].secret_id
    ADMIN_TOKEN  = google_secret_manager_secret.this["admin-token"].secret_id
  }
  invokers = ["allUsers"]

  depends_on = [google_secret_manager_secret_version.this, google_secret_manager_secret_iam_member.api]
}
