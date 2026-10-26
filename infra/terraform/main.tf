locals {
  name = "smart-grid"
  services = [
    "run.googleapis.com",
    "artifactregistry.googleapis.com",
    "secretmanager.googleapis.com",
    "cloudscheduler.googleapis.com",
    "cloudbuild.googleapis.com",
    "iam.googleapis.com",
    "storage.googleapis.com",
    "billingbudgets.googleapis.com",
  ]
  registry   = "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.images.repository_id}"
  web_origin = var.create_vercel_project ? "https://${vercel_project.web[0].name}.vercel.app" : ""
  allowed_origins = compact(concat(
    [local.web_origin, "http://localhost:5173"],
    var.extra_allowed_origins,
  ))
}

resource "google_project_service" "enabled" {
  for_each           = toset(local.services)
  service            = each.value
  disable_on_destroy = false
}

# Docker images. The cleanup policy keeps storage under the 0.5 GB free tier.
resource "google_artifact_registry_repository" "images" {
  repository_id = local.name
  location      = var.region
  format        = "DOCKER"

  cleanup_policy_dry_run = false
  cleanup_policies {
    id     = "keep-recent"
    action = "KEEP"
    most_recent_versions {
      keep_count = 3
    }
  }
  cleanup_policies {
    id     = "delete-old"
    action = "DELETE"
    condition {
      older_than = "604800s"
    }
  }

  depends_on = [google_project_service.enabled]
}

# Trained model artifacts (joblib). 5 GB standard storage is free in us-east1.
resource "google_storage_bucket" "models" {
  name                        = "${var.project_id}-${local.name}-models"
  location                    = upper(var.region)
  storage_class               = "STANDARD"
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"
  force_destroy               = false

  depends_on = [google_project_service.enabled]
}

resource "google_service_account" "api" {
  account_id   = "${local.name}-api"
  display_name = "smart-grid API gateway"
}

resource "google_service_account" "ml" {
  account_id   = "${local.name}-ml"
  display_name = "smart-grid ML service"
}

resource "google_service_account" "scheduler" {
  account_id   = "${local.name}-scheduler"
  display_name = "smart-grid ingestion scheduler"
}

resource "google_storage_bucket_iam_member" "ml_models" {
  bucket = google_storage_bucket.models.name
  role   = "roles/storage.objectAdmin"
  member = "serviceAccount:${google_service_account.ml.email}"
}
