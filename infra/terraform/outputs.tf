output "api_url" {
  description = "Public URL of the Go API."
  value       = module.api.uri
}

output "ml_url" {
  description = "Private URL of the ML service."
  value       = module.ml.uri
}

output "web_url" {
  description = "Vercel URL of the UI."
  value       = local.web_origin
}

output "image_registry" {
  description = "Artifact Registry path for docker push."
  value       = local.registry
}

output "models_bucket" {
  description = "GCS bucket holding model artifacts."
  value       = google_storage_bucket.models.name
}

output "admin_token" {
  description = "Token for training/ingestion from the UI (Admin token button)."
  value       = random_password.admin_token.result
  sensitive   = true
}
