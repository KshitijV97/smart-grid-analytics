# Hobby plan: free for non-commercial projects. Vercel builds web/ on every push.
resource "vercel_project" "web" {
  count          = var.create_vercel_project ? 1 : 0
  name           = local.name
  framework      = "vite"
  root_directory = "web"

  git_repository = {
    type              = "github"
    repo              = var.github_repo
    production_branch = "main"
  }
}

resource "vercel_project_environment_variable" "api_url" {
  count      = var.create_vercel_project ? 1 : 0
  project_id = vercel_project.web[0].id
  key        = "VITE_API_BASE_URL"
  value      = module.api.uri
  target     = ["production", "preview"]
}
