resource "random_password" "db" {
  length  = 32
  special = false
}

resource "random_password" "admin_token" {
  length  = 40
  special = false
}

locals {
  supabase_ref  = var.create_supabase_project ? supabase_project.db[0].id : ""
  pooler_host   = var.supabase_pooler_host != "" ? var.supabase_pooler_host : "aws-0-${var.supabase_region}.pooler.supabase.com"
  supabase_url  = var.create_supabase_project ? "postgresql://postgres.${local.supabase_ref}:${random_password.db.result}@${local.pooler_host}:5432/postgres?sslmode=require" : ""
  database_url  = var.database_url != "" ? var.database_url : local.supabase_url
  secret_values = { "database-url" = local.database_url, "admin-token" = random_password.admin_token.result }
}

# Two secrets, one version each: inside Secret Manager's free 6 active versions.
resource "google_secret_manager_secret" "this" {
  for_each  = local.secret_values
  secret_id = "${local.name}-${each.key}"
  replication {
    auto {}
  }
  depends_on = [google_project_service.enabled]
}

resource "google_secret_manager_secret_version" "this" {
  for_each    = local.secret_values
  secret      = google_secret_manager_secret.this[each.key].id
  secret_data = each.value
}

resource "google_secret_manager_secret_iam_member" "api" {
  for_each  = local.secret_values
  secret_id = google_secret_manager_secret.this[each.key].id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.api.email}"
}

resource "google_secret_manager_secret_iam_member" "ml_db" {
  secret_id = google_secret_manager_secret.this["database-url"].id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.ml.email}"
}
