# Cloud Scheduler: 3 jobs free per billing account; this uses one.
resource "google_cloud_scheduler_job" "ingest" {
  name             = "${local.name}-ingest"
  region           = var.region
  schedule         = var.ingest_schedule
  time_zone        = "America/Toronto"
  attempt_deadline = "1800s"

  http_target {
    http_method = "POST"
    uri         = "${module.ml.uri}/ingest"
    headers     = { "Content-Type" = "application/json" }
    body        = base64encode(jsonencode({ wait = true }))

    oidc_token {
      service_account_email = google_service_account.scheduler.email
      audience              = module.ml.uri
    }
  }

  retry_config {
    retry_count = 1
  }

  depends_on = [google_project_service.enabled]
}
