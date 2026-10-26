provider "google" {
  project = var.project_id
  region  = var.region
}

# Token from SUPABASE_ACCESS_TOKEN.
provider "supabase" {}

# Token from VERCEL_API_TOKEN.
provider "vercel" {
  team = var.vercel_team_id
}
