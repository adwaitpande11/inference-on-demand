# Control Plane UI Deployment (AWS S3)

This directory contains the independent Terraform configuration for hosting the `inference-on-demand` web control plane UI on Amazon S3 with static website hosting.

## Architecture

```
User Browser
    │
    ├── Loads UI assets (HTML/CSS/JS) ──> S3 Static Website Endpoint ($0.01/mo, zero idle compute)
    │
    ├── Lifecycle API calls (Basic Auth) ──> API Gateway HTTP API (`deploy/aws/`)
    │
    └── Inference calls (Port 11434) ──> Direct to EC2 Ollama instance (when READY)
```

This deployment is completely decoupled from the core backend compute orchestration in `deploy/aws/`. You can update, deploy, or tear down the UI without affecting your running backend resources or Terraform state.

---

## Deployment Steps

### 1. Configure Variables

Create a `terraform.tfvars` file inside this directory:

```hcl
aws_region  = "ap-south-1"
bucket_name = "my-inference-control-plane-unique-bucket-name"
```

### 2. Initialize and Apply Terraform

```bash
cd deploy/aws/ui
terraform init
terraform apply
```

Note the output `ui_website_url`.

### 3. Deploy UI Assets

Sync the static web application files from the `widget/` directory to the newly created S3 bucket:

```bash
aws s3 sync ../../../widget/ s3://<your-bucket-name>/ --delete
```

### 4. Open Control Plane

Open the `ui_website_url` in your browser. Enter your API Gateway URL (output from `deploy/aws/`) and your credentials (from `/inference-on-demand/basic-auth-user` and `/inference-on-demand/basic-auth-password`).
