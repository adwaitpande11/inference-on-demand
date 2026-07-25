variable "aws_region" {
  description = "AWS region for the persistent infrastructure"
  type        = string
}

variable "tf_cloud_org" {
  description = "Terraform Cloud organization name"
  type        = string
}

variable "tf_cloud_workspace" {
  description = "Terraform Cloud workspace name"
  type        = string
}
