# Adoption Guide

This guide walks you through setting up `inference-on-demand` on AWS with Cloudflare DNS.

Everything in this guide is a **one-time setup**. Once complete, your day-to-day usage is just clicking Start and Stop in the widget.

Each stage builds on a working version of the one before it — infra first, then the AMI in isolation, then a manually launched instance, then the API layer without DNS, then the full loop with DNS, then the widget. This keeps failures isolated to a single layer at a time instead of debugging everything at once.

Values you'll need (AMI IDs, security group IDs, API URLs, tokens) are fetched from the AWS or Cloudflare console at the exact point you need them, rather than asked to be noted down in advance.

> **Using a different cloud or DNS provider?** The setup steps for your provider will differ. Follow the same stages but refer to `architecture/provider-architecture.md` for guidance.

---

## Before You Begin

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
- `curl` (used throughout to verify each layer)

> Terraform Cloud stores state, but `terraform apply` runs **locally** on your machine, not on Terraform Cloud's remote workers. This is required because the Lambda packaging step needs access to the full repo checkout (`api/`), which Terraform Cloud's remote execution environment does not have.

---

## Overview

```
Stage 1  — AWS account prep
Stage 2  — Terraform Cloud setup
Stage 3  — Deploy persistent infrastructure     🏁 infra live, $0 spent, nothing ephemeral yet
Stage 4  — Build the custom AMI                 🏁 AMI proven in isolation
Stage 5  — Manually verify a real instance      🏁 AMI proven as a real ephemeral instance
Stage 6  — Minimum runtime config for testing
Stage 7  — Test /status via the API Gateway console URL   🏁 API layer proven, no DNS involved
Stage 8  — Cloudflare domain setup
Stage 9  — Remaining runtime config
Stage 10 — First full session via curl          🏁 full system proven end-to-end
Stage 11 — Embed the widget
Stage 12 — Daily usage
```

---

## Stage 1 — AWS Account Prep

> One-time. Creates the IAM user used by Terraform locally.

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
8. Copy the **Access Key ID** and **Secret Access Key** — you will export these locally in Stage 3

---

## Stage 2 — Terraform Cloud Setup

> One-time. Creates the workspace that holds state for your persistent infrastructure. Execution mode is set to Local.

### 2.1 — Create a Terraform Cloud account

1. Go to [https://app.terraform.io](https://app.terraform.io)
2. Sign up or log in
3. Create an **organisation** — note the name

### 2.2 — Create a workspace

1. Click **New → Workspace → API-driven workflow**
2. Name it `inference-on-demand`
3. Click **Create workspace**

### 2.3 — Set execution mode to Local

1. Go to your workspace → **Settings → General**
2. Under **Execution Mode**, select **Local**
3. Click **Save settings**

This is required because the Lambda packaging step needs access to the full repo checkout (`api/`), which lives outside `deploy/aws/`. Terraform Cloud's remote workers only receive the `deploy/aws/` directory, so packaging would fail there.

---

## Stage 3 — Deploy Persistent Infrastructure

> One-time. Deploys Lambda, API Gateway, IAM, and Security Group using Terraform, run locally.

### 3.1 — Clone the repo

```bash
git clone https://github.com/adwaitpande11/inference-on-demand.git
cd inference-on-demand
```

### 3.2 — Create your variables file

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

### 3.3 — Export AWS credentials locally

```bash
export AWS_ACCESS_KEY_ID="your-access-key-from-stage-1"
export AWS_SECRET_ACCESS_KEY="your-secret-key-from-stage-1"
```

> These are only needed in your current terminal session. They are not stored anywhere in the repo.

### 3.4 — Deploy

```bash
terraform login
cd deploy/aws
terraform init
terraform apply
```

Type `yes` when prompted. Terraform will print outputs when finished — you don't need to note these down. Later stages fetch what they need directly from the AWS Console.

**🏁 Checkpoint:** All 29 resources are live — Lambda functions, API Gateway, IAM, CloudWatch log groups, Security Group. Everything here is usage-based with zero idle cost, so this is safe to leave running indefinitely. Nothing ephemeral (EC2, DNS) exists yet, and you haven't touched Cloudflare at all.

---

## Stage 4 — Build the Custom AMI

> One-time. Pre-installs Ollama and your model on an EC2 image, and proves inference works before any orchestration is involved.

All steps done in the **AWS Console**.

### 4.1 — Launch a temporary builder instance

1. Go to **EC2 → Instances → Launch instances**
2. Configure:
   - **Name:** `ollama-ami-builder`
   - **AMI:** Latest Amazon Linux 2023 (x86_64)
   - **Instance type:** Prioritize RAM over vCPU count — LLM inference is memory-bandwidth bound, not compute bound. Avoid micro/small instance types; they will fail to load the model with an out-of-memory error. `m5.xlarge` or `c5.xlarge` (16GB / 8GB RAM) are reasonable choices for a 3B model.
   - **Key pair:** Proceed without key pair
   - **Storage:** 20GB minimum (gp3). This becomes the root volume size for every future ephemeral instance launched from this AMI, so don't undersize it.
   - **Network settings:** Leave the defaults. Under **Security group**, just verify **Create security group** is selected and that **Allow SSH traffic from** is checked (defaults to "My IP", which AWS fills in automatically) — this is what lets you connect via EC2 Instance Connect.
3. Click **Launch instance**

### 4.2 — Connect via EC2 Instance Connect

1. Select the instance in the list → wait until **Instance state** shows `Running` and **Status checks** show `2/2 checks passed`
2. Click **Connect → EC2 Instance Connect → Connect**

A browser-based terminal opens.

### 4.3 — Install Ollama and pull your model

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

### 4.4 — Test inference locally, before snapshotting

```bash
# Confirm the service is running and listening
sudo systemctl status ollama
curl http://localhost:11434/
# Should return: "Ollama is running"

# Run a real inference request
curl http://localhost:11434/api/generate -d '{
  "model": "llama3.2:3b",
  "prompt": "Say hello in one sentence.",
  "stream": false
}'
```

You should get back a JSON response with a `response` field containing generated text. Don't proceed until this works — it's far easier to fix here than after the AMI is baked.

### 4.5 — Stop the instance

Select the instance → **Instance state → Stop instance**. Wait until **Instance state** shows `Stopped`.

Snapshotting from a stopped instance gives a clean, predictable image — no in-flight writes to worry about.

### 4.6 — Create an AMI from the instance

1. Select the stopped instance → **Actions → Image and templates → Create image**
2. Name it `inference-on-demand-ollama-llama3.2-3b`
3. Click **Create image**
4. Go to **EC2 → AMIs** and wait for status `available` (typically 5–10 minutes)

### 4.7 — Terminate the builder instance

Select the instance → **Instance state → Terminate instance**.

**🏁 Checkpoint:** The AMI is proven to boot correctly, install Ollama, load the model, and respond to inference — entirely in isolation, with no AWS orchestration involved yet.

---

## Stage 5 — Manually Verify a Real Instance From the AMI

> Proves the AMI works as a standalone ephemeral instance would, before Lambda ever launches one.

### 5.1 — Launch an instance from your AMI

1. Go to **EC2 → Instances → Launch instances**
2. Configure:
   - **AMI:** My AMIs → select the image you created in Stage 4
   - **Instance type:** Same sizing guidance as Stage 4.1
   - **Key pair:** Proceed without key pair
   - **Security group:** Select **Select existing security group**, then choose the one named `inference-on-demand-ollama-sg` — this was created by Terraform in Stage 3 and will appear in the dropdown
3. Click **Launch instance**

### 5.2 — Test health and inference via the public IP

Once the instance shows `Running`, find its **Public IPv4 address** on the instance summary page. Allow ~30–60 seconds for Ollama to finish loading the model (this happens automatically via the systemd service baked into the AMI).

```bash
curl http://<public-ip>:11434/
# Should return: "Ollama is running"

curl http://<public-ip>:11434/api/generate -d '{
  "model": "llama3.2:3b",
  "prompt": "Say hello in one sentence.",
  "stream": false
}'
```

### 5.3 — Terminate the instance

Select the instance → **Instance state → Terminate instance**.

**🏁 Checkpoint:** The AMI works correctly as a real, independently-launched ephemeral instance — proving the image itself is solid before Lambda's orchestration logic is added to the picture.

---

## Stage 6 — Minimum Runtime Config for Testing

> Populates only what the `/status` endpoint and the Basic Auth authorizer need — not the full parameter set yet.

Go to **AWS Console → Systems Manager → Parameter Store → Create parameter** for each:

| Name | Type | Value |
|---|---|---|
| `/inference-on-demand/compute-provider` | String | `aws_ec2` |
| `/inference-on-demand/basic-auth-user` | SecureString | A username of your choice |
| `/inference-on-demand/basic-auth-password` | SecureString | A password of your choice |

The remaining parameters — AMI ID, instance type, subnet, security group, and all Cloudflare-related values — aren't needed until Stage 9, when `/start` is tested for the first time. Keeping the parameter set minimal at this stage isolates any issues to just the API and auth layer.

---

## Stage 7 — Test /status via the API Gateway Console URL

> Proves Lambda, API Gateway, and Basic Auth all work correctly — completely decoupled from EC2 and DNS.

### 7.1 — Find your API Gateway URL

Go to **AWS Console → API Gateway → APIs → inference-on-demand-http-api**. The **Invoke URL** is shown on the API's details page — copy it.

### 7.2 — Call /status

```bash
curl -u <basic-auth-user>:<basic-auth-password> https://<invoke-url>/status
```

Expected response — no active instance:

```json
{ "status": "terminated" }
```

If you get a `401`, check your Basic Auth credentials match what's in SSM. If you get a `500`, check CloudWatch logs for `/aws/lambda/inference-on-demand-status`.

**🏁 Checkpoint:** The API layer works end-to-end — routing, authorization, and the compute provider's tag-based lookup logic — without any dependency on DNS or a running instance.

---

## Stage 8 — Cloudflare Domain Setup

> One-time. Skip if your domain is already on Cloudflare.

1. Log in to [https://dash.cloudflare.com](https://dash.cloudflare.com)
2. Click **Add a site** and follow the instructions to point your domain's nameservers to Cloudflare

---

## Stage 9 — Remaining Runtime Config

> Completes the SSM parameter set so `/start` and `/stop` can fully orchestrate EC2 and DNS. Each value below is fetched at the point you need it.

Go to **AWS Console → Systems Manager → Parameter Store → Create parameter** for each:

| Name | Type | Where to get the value |
|---|---|---|
| `/inference-on-demand/ami-id` | String | EC2 → AMIs → copy the AMI ID for the image built in Stage 4 |
| `/inference-on-demand/instance-type` | String | The instance type you used in Stage 4.1 |
| `/inference-on-demand/subnet-id` | String | VPC → Subnets → pick a public subnet in your region → copy its Subnet ID |
| `/inference-on-demand/security-group-id` | String | EC2 → Security Groups → find `inference-on-demand-ollama-sg` → copy its Security Group ID |
| `/inference-on-demand/dns-provider` | String | `cloudflare` |
| `/inference-on-demand/cf-token` | SecureString | Cloudflare dashboard → Profile → API Tokens → Create Token → "Edit zone DNS" template → select your domain → Create Token. Cloudflare shows the token only once — copy it immediately. |
| `/inference-on-demand/cf-zone-id` | SecureString | Cloudflare dashboard → click your domain → copy the **Zone ID** shown under API on the right |
| `/inference-on-demand/cf-subdomain` | String | A subdomain of your choice, e.g. `inference` |
| `/inference-on-demand/cf-domain` | String | Your domain, e.g. `yourdomain.com` |

---

## Stage 10 — First Full Session via curl

> Proves the entire ephemeral loop — EC2 launch, DNS record creation, Ollama serving a real request, and clean teardown — before ever touching a browser.

### 10.1 — Start an instance

```bash
curl -u <basic-auth-user>:<basic-auth-password> -X POST https://<invoke-url>/start
```

### 10.2 — Poll status until ready

```bash
curl -u <basic-auth-user>:<basic-auth-password> https://<invoke-url>/status
```

Repeat every ~10 seconds until state shows `running`.

### 10.3 — Wait for Ollama, then test inference via the subdomain

Allow ~30–60 seconds after `running` for Ollama to finish loading, then:

```bash
curl http://inference.yourdomain.com:11434/api/generate -d '{
  "model": "llama3.2:3b",
  "prompt": "Say hello in one sentence.",
  "stream": false
}'
```

### 10.4 — Stop the instance

```bash
curl -u <basic-auth-user>:<basic-auth-password> -X POST https://<invoke-url>/stop
```

Confirm teardown:

```bash
curl -u <basic-auth-user>:<basic-auth-password> https://<invoke-url>/status
```

Expected: `{ "status": "terminated" }`, and the EC2 instance shows `terminated` in the AWS Console.

**🏁 Checkpoint:** The full system works end-to-end through the same interface a real user's app would use — before adding any browser or CORS complexity.

---

## Stage 11 — Embed the Widget

> Wires up the browser experience now that the backend is fully proven.

### Embed the widget

```html
<script
  src="path/to/inference-widget.js"
  data-api-url="https://<invoke-url>"
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

### Test it

1. Open `widget/demo.html` (or your own app) in a browser
2. Click **▶ Start** — watch it move through Starting... to Ready
3. Confirm the `ollamaReady` event fires with the correct endpoint
4. Click **■ Stop** — confirm it returns to the Start state

---

## Stage 12 — Daily Usage

> This is all you do from now on.

1. Click **▶ Start** — wait ~2 minutes for boot + model load
2. Widget fires `ollamaReady` — make your inference calls
3. Click **■ Stop** when done — instance terminated, DNS removed, billing stops

---

## Troubleshooting

**`terraform apply` fails with "Either workspace name or prefix is required"**
- The `backend "remote"` block needs the organization and workspace name filled in directly in `providers.tf` — Terraform backend blocks cannot reference variables.

**`terraform apply` fails with "No valid credential sources found"**
- AWS credentials must be exported in your local terminal session before running `terraform apply`. See Stage 3.3.

**`terraform apply` fails with "Unable to locate repository root containing api/start.py"**
- Execution mode is set to Remote instead of Local. Go to Terraform Cloud → your workspace → Settings → General → Execution Mode, and switch to Local. See Stage 2.3.

**curl commands fail with a PowerShell parameter binding error**
- PowerShell aliases `curl` to `Invoke-WebRequest`, which has different syntax. Use `curl.exe` explicitly instead of bare `curl`, or run `Set-Alias curl curl.exe` once per session.

**Ollama returns "insufficient memory" / `ggml_aligned_malloc` errors**
- The instance type doesn't have enough RAM to load the model. See the sizing guidance in Stage 4.1 — avoid micro/small instance types.

**Lambda fails with `Runtime.ImportModuleError: No module named 'api'`**
- The build packaging flattens `api/`'s contents into the deployment zip root, so imports must not use an `api.` prefix (e.g. `from providers.aws_ec2 import ...`, not `from api.providers.aws_ec2 import ...`). Check every file under `api/`, including `__init__.py` files, for leftover `api.`-prefixed imports.

**`/status` always returns `"terminated"` even though an instance is running**
- Check three things: (1) an instance is actually `running` in the EC2 console, (2) the instance is tagged exactly `ManagedBy=inference-on-demand`, (3) the region the AWS EC2 provider queries matches the region the instance was actually launched in.

**Widget stays on Starting... for more than 5 minutes**
- Go to **AWS Console → EC2 → Instances** and check instance state
- Go to **CloudWatch → Log groups → /aws/lambda/inference-on-demand-start** for Lambda logs

**Subdomain does not resolve after instance is ready**
- Cloudflare TTL is 60 seconds — wait and retry
- Check Cloudflare dashboard → DNS for the A record

---

## Updating Your Model

1. Repeat Stage 4 with a different `ollama pull` command
2. Update `/inference-on-demand/ami-id` in SSM Parameter Store
3. No code changes needed — Lambda reads AMI ID from SSM at runtime