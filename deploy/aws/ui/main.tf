resource "aws_s3_bucket" "ui" {
  bucket = var.bucket_name
  tags   = var.tags
}

resource "aws_s3_bucket_website_configuration" "ui" {
  bucket = aws_s3_bucket.ui.id

  index_document {
    suffix = "index.html"
  }

  error_document {
    key = "index.html"
  }
}

resource "aws_s3_bucket_public_access_block" "ui" {
  bucket = aws_s3_bucket.ui.id

  block_public_acls       = false
  block_public_policy     = false
  ignore_public_acls      = false
  restrict_public_buckets = false
}

resource "aws_s3_bucket_policy" "ui_public_read" {
  bucket = aws_s3_bucket.ui.id

  depends_on = [aws_s3_bucket_public_access_block.ui]

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "PublicReadGetObject"
        Effect    = "Allow"
        Principal = "*"
        Action    = "s3:GetObject"
        Resource  = "${aws_s3_bucket.ui.arn}/*"
      }
    ]
  })
}

locals {
  mime_types = {
    "html" = "text/html"
    "css"  = "text/css"
    "js"   = "application/javascript"
    "json" = "application/json"
    "png"  = "image/png"
    "svg"  = "image/svg+xml"
    "ico"  = "image/x-icon"
  }
}

resource "aws_s3_object" "ui_files" {
  for_each = fileset("${path.module}/../../../widget", "**/*")

  bucket = aws_s3_bucket.ui.id
  key    = each.value
  source = "${path.module}/../../../widget/${each.value}"
  etag   = filemd5("${path.module}/../../../widget/${each.value}")

  content_type = lookup(
    local.mime_types,
    regex("[^.]+$", each.value),
    "application/octet-stream"
  )

  depends_on = [aws_s3_bucket_policy.ui_public_read]
}

