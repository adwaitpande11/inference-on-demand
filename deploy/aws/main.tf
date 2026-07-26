data "aws_caller_identity" "current" {}

resource "aws_iam_role" "lambda_exec" {
  name = "inference-on-demand-lambda-exec"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "lambda.amazonaws.com"
        }
      }
    ]
  })
}

resource "aws_iam_role_policy" "lambda_exec_policy" {
  name = "inference-on-demand-lambda-exec-policy"
  role = aws_iam_role.lambda_exec.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "ec2:RunInstances",
          "ec2:TerminateInstances",
          "ec2:DescribeInstances"
        ]
        Resource = "*"
      },
      {
        Effect = "Allow"
        Action = [
          "ssm:GetParameter",
          "ssm:GetParameters"
        ]
        Resource = "arn:aws:ssm:${var.aws_region}:${data.aws_caller_identity.current.account_id}:parameter/inference-on-demand/*"
      },
      {
        Effect = "Allow"
        Action = [
          "logs:CreateLogGroup",
          "logs:CreateLogStream",
          "logs:PutLogEvents"
        ]
        Resource = "*"
      }
    ]
  })
}

resource "aws_security_group" "ollama_ec2_sg" {
  name        = "inference-on-demand-ollama-sg"
  description = "Allow access to the Ollama EC2 instance on port 11434"

  ingress {
    from_port   = 11434
    to_port     = 11434
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_cloudwatch_log_group" "start" {
  name              = "/aws/lambda/inference-on-demand-start"
  retention_in_days = 7
}

resource "aws_cloudwatch_log_group" "stop" {
  name              = "/aws/lambda/inference-on-demand-stop"
  retention_in_days = 7
}

resource "aws_cloudwatch_log_group" "status" {
  name              = "/aws/lambda/inference-on-demand-status"
  retention_in_days = 7
}

resource "aws_cloudwatch_log_group" "authorizer" {
  name              = "/aws/lambda/inference-on-demand-authorizer"
  retention_in_days = 7
}

resource "null_resource" "build_lambda_packages" {
  triggers = {
    source_hash = "repo-packaging"
  }

  provisioner "local-exec" {
    command = <<-EOT
      set -e
      REPO_ROOT="$PWD"
      while [ "$REPO_ROOT" != "/" ]; do
        if [ -f "$REPO_ROOT/api/start.py" ]; then
          break
        fi
        REPO_ROOT="$(dirname "$REPO_ROOT")"
      done

      if [ ! -f "$REPO_ROOT/api/start.py" ]; then
        echo "Unable to locate repository root containing api/start.py" >&2
        exit 1
      fi

      cd "$REPO_ROOT"
      rm -rf .build
      mkdir -p .build
      mkdir -p .build/lambda-packages
      python3 -m pip install --target .build/lambda-packages -r "$REPO_ROOT/api/requirements.txt" >/dev/null 2>&1
      cp -r api/. .build/lambda-packages/
    EOT
  }
}

resource "aws_lambda_function" "start" {
  function_name    = "inference-on-demand-start"
  role             = aws_iam_role.lambda_exec.arn
  handler          = "start.handler"
  runtime          = "python3.12"
  filename         = archive_file.start.output_path
  source_code_hash = archive_file.start.output_base64sha256
  timeout          = 60
  memory_size      = 512

  depends_on = [aws_cloudwatch_log_group.start]
}

resource "aws_lambda_function" "stop" {
  function_name    = "inference-on-demand-stop"
  role             = aws_iam_role.lambda_exec.arn
  handler          = "stop.handler"
  runtime          = "python3.12"
  filename         = archive_file.stop.output_path
  source_code_hash = archive_file.stop.output_base64sha256
  timeout          = 60
  memory_size      = 512

  depends_on = [aws_cloudwatch_log_group.stop]
}

resource "aws_lambda_function" "status" {
  function_name    = "inference-on-demand-status"
  role             = aws_iam_role.lambda_exec.arn
  handler          = "status.handler"
  runtime          = "python3.12"
  filename         = archive_file.status.output_path
  source_code_hash = archive_file.status.output_base64sha256
  timeout          = 60
  memory_size      = 512

  depends_on = [aws_cloudwatch_log_group.status]
}

resource "aws_lambda_function" "authorizer" {
  function_name    = "inference-on-demand-authorizer"
  role             = aws_iam_role.lambda_exec.arn
  handler          = "authorizer.handler"
  runtime          = "python3.12"
  filename         = archive_file.authorizer.output_path
  source_code_hash = archive_file.authorizer.output_base64sha256
  timeout          = 60
  memory_size      = 512

  depends_on = [aws_cloudwatch_log_group.authorizer]
}

resource "aws_lambda_permission" "start_apigw" {
  statement_id  = "AllowExecutionFromAPIGatewayStart"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.start.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.http_api.execution_arn}/*/*"
}

resource "aws_lambda_permission" "stop_apigw" {
  statement_id  = "AllowExecutionFromAPIGatewayStop"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.stop.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.http_api.execution_arn}/*/*"
}

resource "aws_lambda_permission" "status_apigw" {
  statement_id  = "AllowExecutionFromAPIGatewayStatus"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.status.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.http_api.execution_arn}/*/*"
}

resource "aws_lambda_permission" "authorizer_apigw" {
  statement_id  = "AllowExecutionFromAPIGatewayAuthorizer"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.authorizer.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.http_api.execution_arn}/*/*"
}

resource "aws_apigatewayv2_api" "http_api" {
  name          = "inference-on-demand-http-api"
  protocol_type = "HTTP"
}

resource "aws_apigatewayv2_authorizer" "lambda_auth" {
  api_id                            = aws_apigatewayv2_api.http_api.id
  authorizer_type                   = "REQUEST"
  authorizer_uri                    = aws_lambda_function.authorizer.invoke_arn
  identity_sources                  = ["$request.header.Authorization"]
  name                              = "inference-on-demand-authorizer"
  authorizer_payload_format_version = "2.0"
  enable_simple_responses           = true
}

resource "aws_apigatewayv2_integration" "start" {
  api_id                 = aws_apigatewayv2_api.http_api.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.start.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_integration" "stop" {
  api_id                 = aws_apigatewayv2_api.http_api.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.stop.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_integration" "status" {
  api_id                 = aws_apigatewayv2_api.http_api.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.status.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "start" {
  api_id             = aws_apigatewayv2_api.http_api.id
  route_key          = "POST /start"
  target             = "integrations/${aws_apigatewayv2_integration.start.id}"
  authorization_type = "CUSTOM"
  authorizer_id      = aws_apigatewayv2_authorizer.lambda_auth.id
}

resource "aws_apigatewayv2_route" "stop" {
  api_id             = aws_apigatewayv2_api.http_api.id
  route_key          = "POST /stop"
  target             = "integrations/${aws_apigatewayv2_integration.stop.id}"
  authorization_type = "CUSTOM"
  authorizer_id      = aws_apigatewayv2_authorizer.lambda_auth.id
}

resource "aws_apigatewayv2_route" "status" {
  api_id             = aws_apigatewayv2_api.http_api.id
  route_key          = "GET /status"
  target             = "integrations/${aws_apigatewayv2_integration.status.id}"
  authorization_type = "CUSTOM"
  authorizer_id      = aws_apigatewayv2_authorizer.lambda_auth.id
}

resource "aws_apigatewayv2_stage" "default" {
  api_id      = aws_apigatewayv2_api.http_api.id
  name        = "$default"
  auto_deploy = true
}

resource "archive_file" "start" {
  depends_on = [null_resource.build_lambda_packages]

  type        = "zip"
  source_dir  = "${path.module}/../../.build/lambda-packages"
  output_path = "${path.module}/../../.build/start.zip"
}

resource "archive_file" "stop" {
  depends_on = [null_resource.build_lambda_packages]

  type        = "zip"
  source_dir  = "${path.module}/../../.build/lambda-packages"
  output_path = "${path.module}/../../.build/stop.zip"
}

resource "archive_file" "status" {
  depends_on = [null_resource.build_lambda_packages]

  type        = "zip"
  source_dir  = "${path.module}/../../.build/lambda-packages"
  output_path = "${path.module}/../../.build/status.zip"
}

resource "archive_file" "authorizer" {
  depends_on = [null_resource.build_lambda_packages]

  type        = "zip"
  source_dir  = "${path.module}/../../.build/lambda-packages"
  output_path = "${path.module}/../../.build/authorizer.zip"
}
