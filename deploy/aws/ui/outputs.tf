output "ui_bucket_name" {
  description = "Name of the S3 bucket hosting the UI"
  value       = aws_s3_bucket.ui.id
}

output "ui_website_endpoint" {
  description = "Domain of the S3 static website"
  value       = aws_s3_bucket_website_configuration.ui.website_endpoint
}

output "ui_website_url" {
  description = "HTTP URL for the control plane UI"
  value       = "http://${aws_s3_bucket_website_configuration.ui.website_endpoint}"
}
