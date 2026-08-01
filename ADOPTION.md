# Adoption Guide

This guide walks you through setting up `inference-on-demand` on AWS with Cloudflare DNS.

Everything in this guide is a **one-time setup**. Once complete, your day-to-day usage is just clicking Start and Stop in the widget.

> **Using a different cloud or DNS provider?** The setup steps for your provider will differ. Follow the same stages but refer to `architecture/provider-architecture.md` for guidance.

---

## Before You Begin

Make sure you have accounts on these four services. All have free tiers that cover this project.

| Service | Purpose | URL |
|---|---|---|
| AWS | Hosts EC2, Lambda, API Gateway, SSM | https://aws.amazon.com |
| Terraform Cloud | Manages persistent infra state | https://app.terraform.io |
| Cloudflare | DNS — resolves your subdomain to EC2 | https://cloudflare.com |
| GitHub | Hosts this repo | https://github.com |

Tools needed locally:
- [Terraform CLI](https://developer.hashicorp.com/terraform/install) (v1.0+)
- Git
- Python 3.12+ and pip (needed to package Lambda dependencies during apply)
- AWS credentials available locally (see Stage 5)

> Terraform Cloud stores state, but `terraform apply` runs **locally** on your machine, not on Terraform Cloud's remote workers. This is required because the Lambda packaging step needs access to the full repo checkout (`api/`), which Terraform Cloud's remote execution environment does not have — it only receives the `deploy/aws/` directory. See the note in Stage 5 for details.

---

## Overview

```
Stage 1 — AWS prerequisites       (~10 min)
Stage 2 — Terraform Cloud setup   (~10 min)
Stage 3 — Cloudflare setup        (~5 min)
Stage 4 — Build custom AMI        (~20 min)
Stage 5 — Deploy infrastructure   (~10 min)
Stage 6 — Daily usage             (seconds)
```

---

## Stage 1 — AWS Prerequisites

> One-time. Creates the IAM user used both by Terraform locally and stored for reference.

### 1.1 — Create an IAM user for Terraform

1. Log in to the [AWS Console](https://console.aws.amazon.com)
2. Go to **IAM → Users → Create user**
3. Name it `inference-on-demand-tf`
4. Select **Attach policies directly** and attach:
   - `AmazonEC2FullAccess`
   - `AmazonSSMFullAccess`
   - `IAMFullAccess`
   - `AWSLambda_FullAccess`
   - `AmazonAPIGatewayAdministrator`
5. Click **Create user**
6. Open the user → **Security credentials → Create access key**
7. Select **Application running outside AWS**
8. Copy the **Access Key ID** and **Secret Access Key** — you will export these locally in Stage 5


---

## Stage 2 — Terraform Cloud Setup

> One-time. Creates the workspace that holds state for your persistent infrastructure. Execution mode is set to Local — see Stage 5 for why.

### 2.1 — Create a Terraform Cloud account

1. Go to [https://app.terraform.io](https://app.terraform.io)
2. Sign up or log in
3. Create an **organisation** if you don't have one — note the organisation name

### 2.2 — Create a workspace

1. Click **New → Workspace → API-driven workflow**
2. Name it `inference-on-demand`
3. Click **Create workspace**

### 2.3 — Set execution mode to Local

1. Go to your workspace → **Settings → General**
2. Under **Execution Mode**, select **Local**
3. Click **Save settings**

This is required because the Lambda packaging step (`null_resource.build_lambda_packages` in `main.tf`) needs access to the full repo checkout (`api/`), which lives outside `deploy/aws/`. Terraform Cloud's remote workers only receive the `deploy/aws/` directory, so the packaging script would fail to find `api/start.py` on a remote worker. Running `apply` locally means the script executes on your machine, where the full repo is present.

> With Local execution mode, Terraform Cloud only stores remote state — the actual `plan`/`apply` computation happens on your machine using credentials you provide locally (Stage 5).

---

## Stage 3 — Cloudflare Setup

> One-time. Creates the API token Lambda uses at runtime to create and delete DNS records.

### 3.1 — Add your domain to Cloudflare

Skip if your domain is already on Cloudflare.

1. Log in to [https://dash.cloudflare.com](https://dash.cloudflare.com)
2. Click **Add a site** and follow the instructions

### 3.2 — Create a Cloudflare API token

1. Go to [https://dash.cloudflare.com/profile/api-tokens](https://dash.cloudflare.com/profile/api-tokens)
2. Click **Create Token → Edit zone DNS template**
3. Under **Zone Resources**, select your domain
4. Click **Continue to summary → Create Token**
5. Copy the token — you will store this in SSM in Stage 5

### 3.3 — Note your Zone ID

1. In Cloudflare dashboard, click your domain
2. Under **API** on the right, copy the **Zone ID**

---

## Stage 4 — Build the Custom AMI

> One-time. Pre-installs Ollama and your model on an EC2 image. Keeps cold start to ~1–2 min.

All steps done in the **AWS Console**.

### 4.1 — Create an IAM role for SSM access

1. Go to **IAM → Roles → Create role**
2. Select **AWS service → EC2**
3. Attach `AmazonSSMManagedInstanceCore`
4. Name it `ec2-ssm-role` → **Create role**

### 4.2 — Launch a temporary builder instance

1. Go to **EC2 → Instances → Launch instances**
2. Configure:
   - **Name:** `ollama-ami-builder`
   - **AMI:** Latest Amazon Linux 2023 (x86_64)
   - **Instance type:** Matching your model size (16GB RAM minimum)
   - **Key pair:** Proceed without key pair
   - **IAM instance profile:** `ec2-ssm-role`
3. Click **Launch instance** — note the Instance ID

### 4.3 — Connect and install

1. Select the instance → **Connect → Session Manager → Connect**
2. Run in the browser terminal:

```bash
# Install Ollama
curl -fsSL https://ollama.com/install.sh | sh

# Configure to bind to all interfaces
sudo mkdir -p /etc/systemd/system/ollama.service.d
sudo tee /etc/systemd/system/ollama.service.d/override.conf > /dev/null <<'CONF'
[Service]
Environment="OLLAMA_HOST=0.0.0.0:11434"
Environment="OLLAMA_ORIGINS=*"
CONF

sudo systemctl daemon-reload
sudo systemctl enable ollama
sudo systemctl start ollama

# Pull your model
ollama pull llama3.2:3b
ollama list
```

### 4.4 — Snapshot as AMI

1. Select the instance → **Actions → Image and templates → Create image**
2. Name it `inference-on-demand-ollama-llama3.2-3b`
3. Click **Create image**
4. Go to **EC2 → AMIs** — wait for status `available` (~5 min)
5. Note the **AMI ID**

### 4.5 — Terminate the builder instance

1. Select `ollama-ami-builder` → **Instance state → Terminate instance**

---

## Stage 5 — Deploy Persistent Infrastructure

> One-time. Deploys Lambda, API Gateway, IAM, and Security Group using Terraform, run locally. Then stores runtime config in SSM.

### 5.1 — Store runtime config in SSM Parameter Store

Go to **AWS Console → Systems Manager → Parameter Store → Create parameter** for each:

| Name | Type | Value |
|---|---|---|
| `/inference-on-demand/ami-id` | String | AMI ID from Stage 4.4 |
| `/inference-on-demand/instance-type` | String | e.g. `c5.2xlarge` |
| `/inference-on-demand/subnet-id` | String | A public subnet ID in your region |
| `/inference-on-demand/compute-provider` | String | `aws_ec2` |
| `/inference-on-demand/dns-provider` | String | `cloudflare` |
| `/inference-on-demand/cf-token` | SecureString | Cloudflare token from Stage 3.2 |
| `/inference-on-demand/cf-zone-id` | SecureString | Zone ID from Stage 3.3 |
| `/inference-on-demand/cf-subdomain` | String | e.g. `inference` |
| `/inference-on-demand/cf-domain` | String | e.g. `yourdomain.com` |
| `/inference-on-demand/basic-auth-user` | SecureString | Your chosen username |
| `/inference-on-demand/basic-auth-password` | SecureString | Your chosen password |
| `/inference-on-demand/security-group-id` | String | *(come back after 5.5)* |

### 5.2 — Clone the repo

```bash
git clone https://github.com/adwaitpande11/inference-on-demand.git
cd inference-on-demand
```

### 5.3 — Create your variables file

```bash
cp deploy/aws/terraform.tfvars.example deploy/aws/terraform.tfvars
```

Edit `deploy/aws/terraform.tfvars`:

```hcl
aws_region         = "ap-south-1"
tf_cloud_org       = "your-org-name"
tf_cloud_workspace = "inference-on-demand"
```

> `terraform.tfvars` is in `.gitignore` — it will never be committed.

### 5.4 — Export AWS credentials locally

Since `terraform apply` runs on your machine (Local execution mode, set in Stage 2.3), export your AWS credentials as environment variables before running Terraform:

```bash
export AWS_ACCESS_KEY_ID="your-access-key-from-stage-1.1"
export AWS_SECRET_ACCESS_KEY="your-secret-key-from-stage-1.1"
```

> These are only needed in your current terminal session for the apply step. They are not stored anywhere in the repo.

### 5.5 — Deploy

```bash
terraform login
cd deploy/aws
terraform init
terraform apply
```

Type `yes` when prompted. Note the outputs:
- `api_gateway_url` — used in the widget
- `security_group_id` — go back to **Stage 5.1** and add to SSM

### 5.6 — Update the security group SSM parameter

Go back to **SSM Parameter Store** and update `/inference-on-demand/security-group-id` with the `security_group_id` output from Terraform.

---

## Stage 6 — Daily Usage

> This is all you do from now on.

### Embed the widget

```html
<script
  src="path/to/inference-widget.js"
  data-api-url="https://<api-gateway-url>"
  data-token="your-basic-auth-token">
</script>
```

### Listen for events

```javascript
window.addEventListener('ollamaReady', (e) => {
  const endpoint = e.detail.endpoint;
  // http://inference.yourdomain.com:11434
  // POST /api/generate or /api/chat with stream: false
});

window.addEventListener('ollamaOffline', () => {
  // instance terminated
});
```

### Start a session

1. Click **▶ Start**
2. Wait ~2 minutes — instance boots, model loads
3. Widget fires `ollamaReady` — you're ready

### End a session

1. Click **■ Stop**
2. Wait ~30 seconds
3. Instance terminated, DNS record removed, billing stops

---

## Troubleshooting

**Widget stays on Starting... for more than 5 minutes**
- Go to **AWS Console → EC2 → Instances** and check instance state
- Go to **CloudWatch → Log groups → /aws/lambda/inference-on-demand-start** for Lambda logs

**Subdomain does not resolve after instance is ready**
- Cloudflare TTL is 60 seconds — wait and retry
- Check Cloudflare dashboard → DNS for the A record

**Ollama not responding after EC2 is running**
- Model takes ~30–60s to load after boot — the widget's health poller handles this automatically

**SSM Session Manager connect button greyed out**
- Verify `ec2-ssm-role` is attached to the instance
- Wait ~60s — SSM agent needs time to register after boot

**`terraform apply` fails with "Unable to locate repository root containing api/start.py"**
- This means execution mode is set to Remote instead of Local. Go to Terraform Cloud → your workspace → Settings → General → Execution Mode, and switch to Local. See Stage 2.3.

**`terraform apply` fails with "No valid credential sources found"**
- With Local execution mode, AWS credentials must be exported in your local terminal session before running `terraform apply`. See Stage 5.4.

---

## Updating Your Model

1. Repeat Stage 4 with a different `ollama pull` command
2. Update `/inference-on-demand/ami-id` in SSM Parameter Store
3. No code changes needed — Lambda reads AMI ID from SSM at runtime