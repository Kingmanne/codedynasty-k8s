terraform {
  required_version = ">= 1.10"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }

  # Replace the bucket name with the "state_bucket" output from bootstrap/.
  # use_lockfile = native S3 state locking (no DynamoDB lock table needed).
  backend "s3" {
    bucket       = "codedynasty-tfstate-REPLACE_WITH_ACCOUNT_ID"
    key          = "phase1/terraform.tfstate"
    region       = "eu-west-2"
    encrypt      = true
    use_lockfile = true
  }
}

provider "aws" {
  region = var.region

  default_tags {
    tags = {
      Project   = "codedynasty-k8s"
      ManagedBy = "terraform"
    }
  }
}
