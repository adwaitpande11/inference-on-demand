# Adoption Guide

This guide walks you through setting up `inference-on-demand` from scratch.

Everything in this guide is a **one-time setup**. Once complete, your day-to-day usage is just clicking Start and Stop in the widget.

---

## Before You Begin

Make sure you have accounts on these four services. All have free tiers that cover this project.

| Service | Purpose | URL |
|---|---|---|
| AWS | Hosts EC2, Lambda, API Gateway, SSM | https://aws.amazon.com |
| Terraform Cloud | Manages infrastructure state + apply/destroy | https://app.terraform.io |
| Cloudflare | DNS — resolves your subdomain to EC2 | https://cloudflare.com |
| GitHub | Hosts this repo | https://github.com |

You also need these tools installed locally:

- [Terraform CLI](https://developer.hashicorp.com/terraform/install) (v1.0+)
- Git

> No AWS CLI needed. All AWS setup is done via the AWS Console. Terraform Cloud handles all AWS API calls at runtime.

---

## Overview of Steps

There are **6 stages**. Stages 1–5 are one-time setup. Stage 6 is what you repeat daily.

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

> One-time. Creates the IAM user Terraform Cloud will use to provision infrastructure on your behalf.

### 1.1 — Create an IAM user for Terraform

1. Log in to the [AWS Console](https://console.aws.amazon.com)
2. Go to **IAM → Users → Create user**
3. Name it `inference-on-demand-tf`
4. Select **Attach policies directly**
5. Attach the following managed policies:
   - `AmazonEC2FullAccess`
   - `AmazonSSMFullAccess`
   - `IAMFullAccess`
   - `AWSLambda_FullAccess`
   - `AmazonAPIGatewayAdministrator`
6. Click **Create user**
7. Open the user → **Security credentials → Create access key**
8. Select **Application running outside AWS**
9. Download or copy the **Access Key ID** and **Secret Access Key** — you will add these to Terraform Cloud in Stage 2

---

## Stage 2 — Terraform Cloud Setup

> One-time. Creates the workspace that manages your ephemeral EC2 and DNS.

### 2.1 — Create a Terraform Cloud account

1. Go to [https://app.terraform.io](https://app.terraform.io)
2. Sign up or log in
3. Create an **organisation** if you don't have one — note the organisation name

### 2.2 — Create a workspace

1. In your organisation, click **New → Workspace**
2. Select **API-driven workflow** *(important — not VCS-driven)*
3. Name it `inference-on-demand`
4. Click **Create workspace**

### 2.3 — Add environment variables to the workspace

Go to your workspace → **Variables → Add variable**. Add all of the following as **Environment variables** (not Terraform variables). Mark the sensitive ones as **Sensitive**.

| Key | Value | Sensitive |
|---|---|---|
| `AWS_ACCESS_KEY_ID` | IAM access key from Stage 1.1 | Yes |
| `AWS_SECRET_ACCESS_KEY` | IAM secret key from Stage 1.1 | Yes |
| `CLOUDFLARE_API_TOKEN` | *(create this in Stage 3, then come back)* | Yes |

### 2.4 — Generate a Terraform Cloud API token

This token lets your Lambda functions trigger apply/destroy runs.

1. Go to [https://app.terraform.io/app/settings/tokens](https://app.terraform.io/app/settings/tokens)
2. Click **Create an API token**
3. Name it `inference-on-demand-lambda`
4. Copy the token — you will store this in AWS SSM in Stage 5

---

## Stage 3 — Cloudflare Setup

> One-time. Gives Terraform permission to create and remove DNS records on your behalf.

### 3.1 — Add your domain to Cloudflare

Skip this step if your domain is already on Cloudflare.

1. Log in to [https://dash.cloudflare.com](https://dash.cloudflare.com)
2. Click **Add a site** and follow the instructions to point your domain's nameservers to Cloudflare

### 3.2 — Create a Cloudflare API token

1. Go to [https://dash.cloudflare.com/profile/api-tokens](https://dash.cloudflare.com/profile/api-tokens)
2. Click **Create Token**
3. Use the **Edit zone DNS** template
4. Under **Zone Resources**, select your domain
5. Click **Continue to summary → Create Token**
6. Copy the token

Now go back to **Stage 2.3** and add this token as `CLOUDFLARE_API_TOKEN` in your Terraform Cloud workspace.

### 3.3 — Note your Zone ID

1. In the Cloudflare dashboard, click on your domain
2. On the right side under **API**, copy the **Zone ID**

You will use this in Stage 5.

---

## Stage 4 — Build the Custom AMI

> One-time. Creates a pre-baked EC2 image with Ollama and your model already installed. This keeps cold start time to ~1–2 minutes instead of ~10+ minutes.

All steps in this stage are done entirely in the **AWS Console**.

### 4.1 — Create an IAM role for SSM access

Your builder instance needs SSM Session Manager access so you can connect to it without SSH.

1. Go to **IAM → Roles → Create role**
2. Select **AWS service → EC2**
3. Attach the policy `AmazonSSMManagedInstanceCore`
4. Name the role `ec2-ssm-role`
5. Click **Create role**

### 4.2 — Launch a temporary builder instance

1. Go to **EC2 → Instances → Launch instances**
2. Configure as follows:
   - **Name:** `ollama-ami-builder`
   - **AMI:** Search for `Amazon Linux 2023 AMI` — select the latest x86_64 version
   - **Instance type:** `c5.2xlarge`
   - **Key pair:** Select **Proceed without a key pair** *(you will connect via SSM)*
   - **Network settings:** Leave defaults (public subnet is fine for the builder)
   - **IAM instance profile:** Select `ec2-ssm-role` (created in 4.1)
3. Click **Launch instance**
4. Note the **Instance ID** from the confirmation screen

### 4.3 — Connect to the instance via SSM

1. Go to **EC2 → Instances**, select your `ollama-ami-builder` instance
2. Wait until **Instance state** shows `Running` and **Status checks** show `2/2 checks passed`
3. Click **Connect → Session Manager → Connect**

A browser-based terminal opens. Run the following:

```bash
# Install Ollama
curl -fsSL https://ollama.com/install.sh | sh

# Configure Ollama to bind to all interfaces and allow browser origins
sudo mkdir -p /etc/systemd/system/ollama.service.d
sudo tee /etc/systemd/system/ollama.service.d/override.conf > /dev/null <<'CONF'
[Service]
Environment="OLLAMA_HOST=0.0.0.0:11434"
Environment="OLLAMA_ORIGINS=*"
CONF

# Reload and start
sudo systemctl daemon-reload
sudo systemctl enable ollama
sudo systemctl start ollama

# Pull your model — this may take a few minutes
ollama pull llama3.2:3b

# Verify the model is listed
ollama list
```

Once `ollama list` shows your model, close the terminal tab.

### 4.4 — Create an AMI from the instance

1. Go to **EC2 → Instances**, select your `ollama-ami-builder` instance
2. Click **Actions → Image and templates → Create image**
3. Fill in:
   - **Image name:** `inference-on-demand-ollama-llama3.2-3b`
   - **Image description:** `Ollama with llama3.2:3b pre-pulled`
4. Click **Create image**
5. Go to **EC2 → AMIs** and wait until the status changes from `pending` to `available` (~5 minutes)
6. Note the **AMI ID** (e.g. `ami-xxxxxxxxxxxxxxxxx`)

### 4.5 — Store the AMI ID in SSM Parameter Store

1. Go to **Systems Manager → Parameter Store → Create parameter**
2. Fill in:
   - **Name:** `/inference-on-demand/ami-id`
   - **Type:** `String`
   - **Value:** your AMI ID from step above
3. Click **Create parameter**

### 4.6 — Terminate the builder instance

1. Go to **EC2 → Instances**, select `ollama-ami-builder`
2. Click **Instance state → Terminate instance**
3. Confirm termination

---

## Stage 5 — Deploy Persistent Infrastructure

> One-time. Deploys Lambda, API Gateway, IAM roles, and Security Group using Terraform CLI on your machine. Terraform Cloud holds the state.

### 5.1 — Clone the repo

```bash
git clone https://github.com/your-username/inference-on-demand.git
cd inference-on-demand
```

### 5.2 — Create your variables file

```bash
cp infra/terraform.tfvars.example infra/terraform.tfvars
```

Edit `infra/terraform.tfvars` and fill in your values:

```hcl
aws_region          = "ap-south-1"
instance_type       = "c5.2xlarge"
cloudflare_zone_id  = "your-zone-id"       # from Stage 3.3
subdomain           = "inference"           # becomes inference.yourdomain.com
domain              = "yourdomain.com"
tf_cloud_org        = "your-org-name"      # from Stage 2.1
tf_cloud_workspace  = "inference-on-demand"
```

> `terraform.tfvars` is in `.gitignore` — it will never be committed.

### 5.3 — Store secrets in SSM Parameter Store

Store the Terraform Cloud API token so Lambda can trigger runs:

1. Go to **AWS Console → Systems Manager → Parameter Store → Create parameter**
2. Fill in:
   - **Name:** `/inference-on-demand/tf-cloud-token`
   - **Type:** `SecureString`
   - **Value:** Terraform Cloud API token from Stage 2.4
3. Click **Create parameter**

Repeat for Basic Auth credentials (protects the Start/Stop API):

| Name | Type | Value |
|---|---|---|
| `/inference-on-demand/basic-auth-user` | SecureString | your chosen username |
| `/inference-on-demand/basic-auth-password` | SecureString | your chosen password |

### 5.4 — Log in to Terraform Cloud

```bash
terraform login
```

Follow the prompt — it opens a browser tab to generate a local CLI token.

### 5.5 — Deploy

```bash
cd infra
terraform init
terraform apply
```

Review the plan and type `yes` when prompted. This creates:
- IAM role and policy for Lambda
- Security Group (port 11434)
- Lambda functions (start, stop, status, authorizer)
- API Gateway with Basic Auth

Note the `api_gateway_url` in the output — you will use this in the widget.

---

## Stage 6 — Daily Usage

> This is all you do from now on.

### Embed the widget in a client app

```html
<script
  src="path/to/inference-widget.js"
  data-api-url="https://<api-gateway-url>"
  data-token="your-basic-auth-token">
</script>
```

### Listen for the ready event

```javascript
window.addEventListener('ollamaReady', (e) => {
  const endpoint = e.detail.endpoint;
  // endpoint = http://inference.yourdomain.com:11434
  // call /api/generate or /api/chat with stream: false
});

window.addEventListener('ollamaOffline', () => {
  // instance has been terminated
});
```

### Start an inference session

1. Open your app in a browser
2. Click **▶ Start**
3. Wait ~2–3 minutes for the instance to boot and Ollama to load
4. Widget shows **■ Stop** and fires `ollamaReady` — you are ready to make inference calls

### End an inference session

1. Click **■ Stop**
2. Wait ~1–2 minutes for Terraform to destroy the instance
3. Widget returns to **▶ Start** — EC2 is terminated, DNS record is removed, billing stops

---

## Troubleshooting

**Widget stays on Starting... for more than 5 minutes**
- Check the Terraform Cloud workspace run logs at [https://app.terraform.io](https://app.terraform.io)
- Verify `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` are set as **environment variables** (not Terraform variables) in the workspace

**`inference.yourdomain.com` does not resolve after instance is ready**
- Cloudflare DNS TTL is 60 seconds — wait a minute and retry
- Verify the A record was created in Cloudflare dashboard → DNS

**SSM Session Manager connect button is greyed out**
- Verify the instance has the `ec2-ssm-role` IAM profile attached
- Wait a minute — SSM agent needs ~60s after boot to register

---

## Updating Your Model

To switch to a different model, rebuild the AMI:

1. Repeat Stage 4 with a different `ollama pull` command
2. Update the AMI ID in SSM Parameter Store (Stage 4.5) via the AWS Console
3. No code changes or redeployment needed — Terraform reads the AMI ID from SSM at apply time
