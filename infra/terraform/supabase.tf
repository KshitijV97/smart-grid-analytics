# Free tier: 500 MB database, 2 projects per organization. Free projects pause
# after a week without activity; the daily ingestion keeps this one awake.
resource "supabase_project" "db" {
  count             = var.create_supabase_project ? 1 : 0
  organization_id   = var.supabase_organization_id
  name              = local.name
  database_password = random_password.db.result
  region            = var.supabase_region

  lifecycle {
    ignore_changes = [database_password]
  }
}
