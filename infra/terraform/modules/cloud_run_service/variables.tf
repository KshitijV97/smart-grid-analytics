variable "name" {
  description = "Cloud Run service name."
  type        = string
}

variable "region" {
  description = "Cloud Run region."
  type        = string
}

variable "image" {
  description = "Container image URL."
  type        = string
}

variable "service_account_email" {
  description = "Runtime service account."
  type        = string
}

variable "cpu" {
  description = "vCPU limit."
  type        = string
  default     = "1"
}

variable "memory" {
  description = "Memory limit."
  type        = string
  default     = "512Mi"
}

variable "cpu_idle" {
  description = "Throttle CPU outside requests (request-based billing). False keeps CPU for background work."
  type        = bool
  default     = true
}

variable "max_instances" {
  description = "Upper bound on instances (cost guard)."
  type        = number
  default     = 1
}

variable "timeout_seconds" {
  description = "Request timeout."
  type        = number
  default     = 300
}

variable "port" {
  description = "Container port."
  type        = number
  default     = 8080
}

variable "env" {
  description = "Plain environment variables."
  type        = map(string)
  default     = {}
}

variable "secret_env" {
  description = "Environment variables read from Secret Manager (name => secret id, latest version)."
  type        = map(string)
  default     = {}
}

variable "invokers" {
  description = "Members granted roles/run.invoker (\"allUsers\" makes the service public)."
  type        = list(string)
  default     = []
}
