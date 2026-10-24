variable "aws_region" {
  description = "AWS region for the persistent infrastructure"
  type        = string
}

variable "allowed_ui_origins" {
  description = "Allowed origins for API Gateway CORS preflight (e.g. S3 website or localhost)"
  type        = list(string)
  default     = ["*"]
}

variable "apigw_throttling_burst_limit" {
  description = "API Gateway default route throttling burst limit"
  type        = number
  default     = 5
}

variable "apigw_throttling_rate_limit" {
  description = "API Gateway default route throttling rate limit (requests per second)"
  type        = number
  default     = 2
}

variable "lambda_reserved_concurrent_executions" {
  description = "Maximum concurrent executions for each Lambda function (concurrency cap)"
  type        = number
  default     = 2
}

