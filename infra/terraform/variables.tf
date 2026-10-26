variable "project_id" {
  description = "Google Cloud project ID."
  type        = string
}

variable "region" {
  description = "Region for Cloud Run, Artifact Registry and the model bucket. us-east1 is the free-tier region closest to Ottawa."
  type        = string
  default     = "us-east1"
}

variable "image_tag" {
  description = "Tag of the api and ml images in Artifact Registry (pushed by scripts/deploy-images.sh)."
  type        = string
  default     = "latest"
}

variable "billing_account_id" {
  description = "Billing account for a budget alert. Leave empty to skip the budget."
  type        = string
  default     = ""
}

variable "monthly_budget_usd" {
  description = "Budget alert threshold in USD."
  type        = number
  default     = 5
}

# --- Database (Supabase) ---------------------------------------------------

variable "create_supabase_project" {
  description = "Create a Supabase project. Set false and provide database_url to reuse an existing database."
  type        = bool
  default     = true
}

variable "supabase_organization_id" {
  description = "Supabase organization slug (needed when create_supabase_project is true)."
  type        = string
  default     = ""
}

variable "supabase_region" {
  description = "Supabase region. ca-central-1 keeps the data in Canada."
  type        = string
  default     = "ca-central-1"
}

variable "supabase_pooler_host" {
  description = "Supavisor pooler host for the region (Cloud Run has no IPv6 egress, so the direct host cannot be used). Check the project's Connect dialog."
  type        = string
  default     = ""
}

variable "database_url" {
  description = "Postgres URL to use instead of creating a Supabase project."
  type        = string
  default     = ""
  sensitive   = true
}

# --- Frontend (Vercel) -----------------------------------------------------

variable "create_vercel_project" {
  description = "Create the Vercel project for the web UI."
  type        = bool
  default     = true
}

variable "vercel_team_id" {
  description = "Vercel team ID; empty for a personal account."
  type        = string
  default     = null
}

variable "github_repo" {
  description = "GitHub repository (owner/name) Vercel deploys the UI from."
  type        = string
  default     = "kshitijv97/smart-grid-analytics"
}

variable "extra_allowed_origins" {
  description = "Extra browser origins allowed to call the API (e.g. a custom domain)."
  type        = list(string)
  default     = []
}

# --- Scheduling ------------------------------------------------------------

variable "ingest_schedule" {
  description = "Cron (America/Toronto) for incremental ingestion."
  type        = string
  default     = "17 6 * * *"
}
