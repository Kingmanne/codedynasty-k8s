variable "region" {
  description = "AWS region"
  type        = string
  default     = "eu-west-2" # London
}

variable "my_ip_cidr" {
  description = "Your public IP with /32 (e.g. 81.2.3.4/32). Only this address can reach the Kubernetes API."
  type        = string

  validation {
    condition     = can(cidrhost(var.my_ip_cidr, 0))
    error_message = "Must be a CIDR block such as 81.2.3.4/32."
  }
}

variable "alert_email" {
  description = "Email address for budget alerts"
  type        = string
}

variable "monthly_budget_usd" {
  description = "Monthly spend that triggers alerts at 50%, 80% and 100%"
  type        = number
  default     = 30
}

variable "instance_type" {
  description = "EC2 size. k3s + Argo CD + Prometheus + PostgreSQL needs about 4 GB RAM."
  type        = string
  default     = "t3.medium"
}

variable "root_volume_gb" {
  description = "Disk size for the node"
  type        = number
  default     = 30
}

variable "ecr_repositories" {
  description = "One ECR repository per service"
  type        = list(string)
  default     = ["signup-api", "signup-worker", "login", "list-users", "frontend"]
}

variable "ecr_credential_provider_version" {
  description = "Version of the Kubernetes ECR credential provider the node installs at boot"
  type        = string
  default     = "v1.31.0"
}
