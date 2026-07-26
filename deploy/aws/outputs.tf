output "api_gateway_url" {
  description = "The URL of the HTTP API Gateway"
  value       = aws_apigatewayv2_api.http_api.api_endpoint
}

output "security_group_id" {
  description = "The ID of the security group used for the Ollama EC2 instance"
  value       = aws_security_group.ollama_ec2_sg.id
}
