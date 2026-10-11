# AWS deployment notes

The Lambda deployment package for this project is built from the contents of the `api/` directory.

Following infrastructure-as-code best practices, the build and packaging step is executed **outside** Terraform prior to running `terraform plan` or `terraform apply`. This guarantees that Terraform's `archive_file` evaluates the exact directory hash at plan time and ensures idempotent, reproducible deployments.

## Prerequisites

- Python 3.12+
- Terraform CLI (>= 1.5.0)
- AWS credentials exported (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`)

## Build & Deployment Flow

1. **Build the Lambda package:**
   From the repository root, run the build script:
   ```bash
   ./scripts/build-lambda.sh
   ```
   *(On Windows PowerShell, run: `.\scripts\build-lambda.ps1`)*

   This stages `api/` into `.build/lambda-packages/`.

2. **Initialize Terraform:**
   Copy `backend.hcl.example` to `backend.hcl` and set your Terraform Cloud organization:
   ```bash
   cd deploy/aws
   cp backend.hcl.example backend.hcl
   # Edit backend.hcl with your organization name
   terraform init -backend-config="backend.hcl"
   ```

3. **Plan & Apply:**
   ```bash
   terraform plan -var-file="terraform.tfvars"
   terraform apply -var-file="terraform.tfvars"
   ```

   Terraform will compute the package checksum via `archive_file` and deploy the Lambdas, API Gateway, and IAM roles.

