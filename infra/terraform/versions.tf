terraform {
  required_version = ">= 1.9"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 7.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
    supabase = {
      source  = "supabase/supabase"
      version = "~> 1.11"
    }
    vercel = {
      source  = "vercel/vercel"
      version = "~> 3.17"
    }
  }

  # State lives in a GCS bucket created once with scripts/bootstrap-state.sh.
  # Supply it at init time: terraform init -backend-config="bucket=<name>"
  backend "gcs" {
    prefix = "smart-grid-analytics"
  }
}
