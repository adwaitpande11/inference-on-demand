# Adoption Guide

This guide walks you through setting up `inference-on-demand` on AWS.

Everything in this guide is a **one-time setup**. Once complete, your day-to-day usage is just clicking Start and Stop in the control plane UI or widget.

Each stage builds on a working version of the one before it — infra first, then the AMI in isolation, then a manually launched instance, then the API layer, then the full loop via curl, then the UI/widget. This keeps failures isolated to a single layer at a time instead of debugging everything at once.

Values you'll need (AMI IDs, security group IDs, API URLs) are fetched from the AWS console at the exact point you need them, rather than asked to be noted down in advance.

> **Using a different cloud provider?** The setup steps for your provider will differ. Follow the same stages but refer to `architecture/provider-architecture.md` for guidance.

---

## Before You Begin

| Service | Purpose | URL |
|---|---|---|
| AWS | Hosts EC2, Lambda, API Gateway, SSM | https://aws.amazon.com |
| Terraform Cloud | Manages persistent infra state | https://app.terraform.io |
| GitHub | Hosts this repo | https://github.com |

Tools needed locally:
- [Terraform CLI](https://developer.hashicorp.com/terraform/install) (v1.0+)
- Git
- Python 3.12+
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
Stage 7  — Test /status via the API Gateway console URL   🏁 API layer proven
Stage 8  — Remaining runtime config
Stage 9  — First full session via curl          🏁 full system proven end-to-end
Stage 10 — Embed the widget / Control Plane UI
Stage 11 — Daily usage
```

---

## Stage 1 — AWS Account Prep

> One-time. Creates the IAM user used by Terraform locally.

1. Log in to the [AWS Console](https://console.aws.amazon.com)
2. Go to **IAM → Users → Create user**
3. Name it `inference-on-demand-tf`
4. Select **Attach policies directly** and attach:
   - `AdministratorAccess` (recommended for initial setup; can be scoped down later)
5. Click **Create user**
6. Click the user you just created → go to the **Security credentials** tab
7. Scroll to **Access keys → Create access key**
8. Select **Command Line Interface (CLI)**, check the confirmation box, and click **Next → Create access key**
9. Copy the **Access key ID** and **Secret access key**

---

## Stage 2 — Terraform Cloud Setup

> One-time. Sets up the remote state workspace.

1. Log in to [Terraform Cloud](https://app.terraform.io)
2. Create an organization if you don't already have one
3. Click **New → Workspace**
4. Choose **CLI-driven workflow**
5. Name the workspace `inference-on-demand`
6. Click **Create workspace**
7. Once created, go to **Settings → General**
8. Under **Execution Mode**, select **Local**
9. Click **Save settings**

> Local execution mode tells Terraform Cloud: *"Store state remotely, but run plan and apply on the machine running the CLI."*

---

## Stage 3 — Deploy Persistent Infrastructure

> One-time. Deploys the persistent, non-ephemeral infrastructure: Lambda functions, API Gateway, IAM roles, and the EC2 Security Group.

### 3.1 — Clone the repo

```bash
git clone https://github.com/adwaitpande11/inference-on-demand.git
cd inference-on-demand
```

### 3.2 — Configure Terraform inputs

Create `deploy/aws/terraform.tfvars`:

```hcl
aws_region          = "ap-south-1"  # Or your preferred AWS region
tf_cloud_org        = "your-org-name"
tf_cloud_workspace  = "inference-on-demand"
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
# Build the Lambda package first — this must run before terraform apply
./scripts/build-lambda.sh

terraform login
cd deploy/aws
terraform init
terraform apply
```

> `build-lambda.sh` copies `api/` into `.build/lambda-packages/`. Terraform reads that directory at plan time to compute the zip hash — running the build first ensures the hash is always current and Lambda updates are correctly detected.

Type `yes` when prompted. Terraform will print outputs when finished — you don't need to note these down. Later stages fetch what they need directly from the AWS Console.

**🏁 Checkpoint:** All persistent resources are live — Lambda functions, API Gateway, IAM, CloudWatch log groups, Security Group. Everything here is usage-based with zero idle cost, so this is safe to leave running indefinitely. Nothing ephemeral (EC2) exists yet.

---

## Stage 4 — Build the Custom AMI

> One-time. Pre-installs Ollama and your model on an EC2 image, and proves inference works before any orchestration is involved.

All steps done in the **AWS Console**.

### 4.1 — Launch a temporary builder instance

1. Go to **EC2 → Instances → Launch instances**
2. Configure:
   - **Name:** `ollama-ami-builder`
   - **AMI:** Latest Amazon Linux 2023 (x86_64)
   - **Instance type:** Prioritize RAM over vCPU count — LLM inference is memory-bandwidth bound, not compute bound. `m5.xlarge` or `c5.xlarge` (16GB / 8GB RAM) are reasonable choices for a 3B model.
   - **Key pair:** Proceed without key pair
   - **Storage:** 20GB minimum (gp3). This becomes the root volume size for every future ephemeral instance launched from this AMI, so don't undersize it.
   - **Network settings:** Leave the defaults. Under **Security group**, verify **Create security group** is selected and that **Allow SSH traffic from** is checked.
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

You should get back a JSON response with a `response` field containing generated text. Don't proceed until this works.

### 4.5 — Stop the instance

Select the instance → **Instance state → Stop instance**. Wait until **Instance state** shows `Stopped`.

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
   - **Security group:** Select **Select existing security group**, then choose `inference-on-demand-ollama-sg`
3. Click **Launch instance**

### 5.2 — Test health and inference via the public IP

Once the instance shows `Running`, find its **Public IPv4 address** on the instance summary page. Allow ~30–60 seconds for Ollama to finish loading the model.

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

**🏁 Checkpoint:** The AMI works correctly as a real, independently-launched ephemeral instance — proving the image itself is solid before Lambda's orchestration logic is added.

---

## Stage 6 — Minimum Runtime Config for Testing

> Populates what the `/status` endpoint and the Basic Auth authorizer need.

Go to **AWS Console → Systems Manager → Parameter Store → Create parameter** for each:

| Name | Type | Value |
|---|---|---|
| `/inference-on-demand/compute-provider` | String | `aws_ec2` |
| `/inference-on-demand/basic-auth-user` | SecureString | A username of your choice |
| `/inference-on-demand/basic-auth-password` | SecureString | A password of your choice |

The remaining parameters — AMI ID, instance type, subnet, security group — aren't needed until Stage 8, when `/start` is tested for the first time.

---

## Stage 7 — Test /status via the API Gateway Console URL

> Proves Lambda, API Gateway, and Basic Auth all work correctly — completely decoupled from a running instance.

### 7.1 — Find your API Gateway URL

Go to **AWS Console → API Gateway → APIs → inference-on-demand-http-api**. The **Invoke URL** is shown on the API's details page — copy it.

### 7.2 — Call /status

```bash
curl -u <basic-auth-user>:<basic-auth-password> https://<invoke-url>/status
```

Expected response — no active instance:

```json
{ "state": "terminated", "ip": "" }
```

If you get a `401`, check your Basic Auth credentials match what's in SSM. If you get a `500`, check CloudWatch logs for `/aws/lambda/inference-on-demand-status`.

**🏁 Checkpoint:** The API layer works end-to-end — routing, authorization, and the compute provider's tag-based lookup logic.

---

## Stage 8 — Remaining Runtime Config

> Completes the SSM parameter set so `/start` can launch EC2 compute.

Go to **AWS Console → Systems Manager → Parameter Store → Create parameter** for each:

| Name | Type | Where to get the value |
|---|---|---|
| `/inference-on-demand/ami-id` | String | EC2 → AMIs → copy the AMI ID for the image built in Stage 4 |
| `/inference-on-demand/instance-type` | String | The instance type you used in Stage 4.1, e.g. `m5.xlarge` or `c5.xlarge` |
| `/inference-on-demand/subnet-id` | String | VPC → Subnets → pick a public subnet in your region → copy its Subnet ID |
| `/inference-on-demand/security-group-id` | String | EC2 → Security Groups → find `inference-on-demand-ollama-sg` → copy its Security Group ID |

---

## Stage 9 — First Full Session via curl

> Proves the entire ephemeral loop — EC2 launch, Ollama serving a real request, and clean teardown — before touching a browser.

### 9.1 — Start an instance

```bash
curl -u <basic-auth-user>:<basic-auth-password> -X POST https://<invoke-url>/start
```

Expected response:

```json
{ "instance_id": "i-0abc1234def5678" }
```

### 9.2 — Poll status until ready

```bash
curl -u <basic-auth-user>:<basic-auth-password> https://<invoke-url>/status
```

Repeat every ~5-10 seconds until state shows `running` and provides an `ip`:

```json
{ "state": "running", "ip": "54.x.x.x" }
```

### 9.3 — Test inference via the public IP

Allow ~30–60 seconds after `running` for Ollama to finish loading the model, then:

```bash
curl http://<public-ip>:11434/api/generate -d '{
  "model": "llama3.2:3b",
  "prompt": "Say hello in one sentence.",
  "stream": false
}'
```

### 9.4 — Stop the instance

```bash
curl -u <basic-auth-user>:<basic-auth-password> -X POST https://<invoke-url>/stop
```

No request body needed — `/stop` finds the running instance by its `ManagedBy=inference-on-demand` tag.

Confirm teardown:

```bash
curl -u <basic-auth-user>:<basic-auth-password> https://<invoke-url>/status
```

Expected: `{ "state": "terminated", "ip": "" }`, and the EC2 instance shows `terminated` in the AWS Console.

**🏁 Checkpoint:** The full compute lifecycle works end-to-end.

---

## Stage 10 — Embed the Widget / Control Plane UI

### Option A: Control Plane Dashboard
Open `widget/index.html` locally in any modern browser. Enter your API Gateway URL and Basic Auth credentials.

### Option B: Embeddable Widget
```html
<script
  src="path/to/inference-widget.js"
  data-api-url="https://<invoke-url>"
  data-token="your-basic-auth-token">
</script>
```

Listen for events:

```javascript
window.addEventListener('ollamaReady', (e) => {
  const endpoint = e.detail.endpoint; // e.g. http://54.x.x.x:11434
  // POST /api/generate or /api/chat with stream: false
});

window.addEventListener('ollamaOffline', () => {
  // instance terminated
});
```

---

## Stage 11 — Daily Usage

> This is all you do from now on:

1. Click **▶ Start** — wait ~1–2 minutes for boot + model load
2. Widget fires `ollamaReady` with the endpoint — make your inference calls
3. Click **■ Stop** when done — instance terminated, billing stops

---

## Troubleshooting

**`terraform apply` fails with "Either workspace name or prefix is required"**
- The `backend "remote"` block needs the organization and workspace name filled in directly in `providers.tf` — Terraform backend blocks cannot reference variables.

**`terraform apply` fails with "No valid credential sources found"**
- AWS credentials must be exported in your local terminal session before running `terraform apply`. See Stage 3.3.

**`terraform apply` fails with "Unable to locate repository root containing api/start.py"**
- Execution mode is set to Remote instead of Local. Go to Terraform Cloud → your workspace → Settings → General → Execution Mode, and switch to Local. See Stage 2.3.

**curl commands fail with a PowerShell parameter binding error**
- PowerShell aliases `curl` to `Invoke-WebRequest`, which has different syntax. Use `curl.exe` explicitly instead of bare `curl`.

**Ollama returns "insufficient memory" / `ggml_aligned_malloc` errors**
- The instance type doesn't have enough RAM to load the model. See the sizing guidance in Stage 4.1 — avoid micro/small instance types.

**`/status` always returns `"terminated"` even though an instance is running**
- Check three things: (1) an instance is actually `running` in the EC2 console, (2) the instance is tagged exactly `ManagedBy=inference-on-demand`, (3) the region the AWS EC2 provider queries matches the region the instance was launched in.

---

## Updating Your Model

1. Repeat Stage 4 with a different `ollama pull` command
2. Update `/inference-on-demand/ami-id` in SSM Parameter Store
3. No code changes needed — Lambda reads AMI ID from SSM at runtime