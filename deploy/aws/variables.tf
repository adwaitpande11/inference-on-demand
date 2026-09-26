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

variable "allowed_ui_origins" {
  description = "Allowed origins for API Gateway CORS preflight (e.g. S3 website or localhost)"
  type        = list(string)
  default     = ["*"]
}
