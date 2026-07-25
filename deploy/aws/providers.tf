terraform {
  required_version = ">= 1.5.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    archive = {
      source  = "hashicorp/archive"
      version = "~> 2.4"
    }
  }

  backend "remote" {
    organization = var.tf_cloud_org
    workspaces {
      name = var.tf_cloud_workspace
    }
  }
}

provider "aws" {
  region = var.aws_region
}
