variable "aws_region" {
  description = "AWS region for UI hosting"
  type        = string
  default     = "ap-south-1"
}

variable "bucket_name" {
  description = "S3 bucket name for control plane UI static website hosting"
  type        = string
}

variable "tags" {
  description = "Tags to apply to resources"
  type        = map(string)
  default = {
    Project   = "inference-on-demand"
    Component = "control-plane-ui"
  }
}
