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
    organization = "adwaitpande11"

    workspaces {
      name = "inference-on-demand"
    }
  }
}

provider "aws" {
  region = var.aws_region
}
