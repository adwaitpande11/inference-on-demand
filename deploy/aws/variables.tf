variable "aws_region" {
  description = "AWS region for the persistent infrastructure"
  type        = string
}

variable "allowed_ui_origins" {
  description = "Allowed origins for API Gateway CORS preflight (e.g. S3 website or localhost)"
  type        = list(string)
  default     = ["*"]
}
