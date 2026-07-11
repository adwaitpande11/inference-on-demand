# Inference on Demand
Ephemeral, private LLM inference on AWS - spins up when you need it, gone when you don't.

No always-on servers. No idle costs. One click to start, one click to destroy.

---

## How It Works

```
Browser Widget
    ├── [Start] → Lambda → Terraform Cloud API → terraform apply
    │                               ↓
    │                       EC2 boots from custom AMI
    │                       Ollama starts automatically
    │                       Cloudflare A record → EC2 public IP
    │
    └── [Ready] → inference calls go direct to your-subdomain.yourdomain.com:11434
```

```
Browser Widget
    └── [Stop] → Lambda → Terraform Cloud API → terraform destroy
                                    ↓
                            EC2 terminated
                            Cloudflare A record removed
```

Terraform Cloud holds the state. Lambda wraps the Terraform Cloud API. The browser widget handles the rest.

---

## Prerequisites

- AWS account
- Cloudflare account with a domain
- Terraform Cloud account (free tier is fine)
- Your own IP address (to lock down port 11434)

---

## Project Structure

```
inference-on-demand/
├── infra/                  # Terraform — persistent resources
│   ├── main.tf             # IAM, Security Group, API Gateway, Lambda
│   ├── variables.tf
│   ├── outputs.tf
│   └── providers.tf
├── lambda/                 # Python — lifecycle triggers
│   ├── authorizer.py       # Basic Auth Lambda Authorizer
│   ├── start.py            # Triggers terraform apply
│   ├── stop.py             # Triggers terraform destroy
│   └── status.py           # Polls run status + Ollama readiness
├── widget/
│   ├── inference-widget.js # Embeddable JS widget
│   └── demo.html           # Standalone test page
├── scripts/
│   └── build-ami.sh        # One-time AMI build script
└── README.md
```

---

## Setup

### 1. Build the custom AMI

The EC2 instance boots from a pre-baked AMI with your inference runtime and model already pulled. This keeps cold start times low (~1–2 min vs ~10+ min with user data scripts).

```bash
# Launch a base Amazon Linux 2023 instance, then run:
bash scripts/build-ami.sh
```

The script installs the inference runtime, pulls your model, configures it as a systemd service, and snapshots the instance as an AMI. Store the resulting AMI ID in SSM Parameter Store:

```bash
aws ssm put-parameter \
  --name "/inference-on-demand/ami-id" \
  --value "ami-xxxxxxxxxxxxxxxxx" \
  --type String
```

### 2. Configure Terraform Cloud

Create a workspace in Terraform Cloud and set these as environment variables (not Terraform variables):

| Variable | Description |
|---|---|
| `AWS_ACCESS_KEY_ID` | IAM user with EC2 permissions |
| `AWS_SECRET_ACCESS_KEY` | Corresponding secret |
| `CLOUDFLARE_API_TOKEN` | Token with DNS edit permission |

### 3. Configure variables

Copy the example file and fill in your values:

```bash
cp infra/terraform.tfvars.example infra/terraform.tfvars
```

```hcl
# infra/terraform.tfvars
aws_region          = "ap-south-1"
instance_type       = "c5.2xlarge"
your_ip             = "x.x.x.x/32"
cloudflare_zone_id  = "your-zone-id"
subdomain           = "inference"
domain              = "yourdomain.com"
```

> **Never commit `terraform.tfvars`** — it is in `.gitignore`.

### 4. Deploy persistent infrastructure

```bash
cd infra
terraform init
terraform apply
```

This creates the IAM roles, Security Group, API Gateway, and Lambda functions. The EC2 instance is **not** created here — it is created on demand.

### 5. Embed the widget

Add this to any web app:

```html
<script
  src="https://your-cdn-or-raw-github/widget/inference-widget.js"
  data-api-url="https://your-api-gateway-url"
  data-token="your-basic-auth-token">
</script>
```

The widget renders a Start / Stop button and fires a browser event when the endpoint is ready:

```javascript
window.addEventListener('inferenceReady', (e) => {
  const endpoint = e.detail.endpoint;
  // e.g. http://inference.yourdomain.com:11434
  // wire up your LLM client here
});
```

---

## Adapting This Project

This project is intentionally not tied to a specific model or inference runtime. To adapt it:

**Different model** — modify `build-ami.sh` to pull a different model before snapshotting.

**Different inference runtime** — replace Ollama with any runtime that exposes an HTTP API. Update the health check URL in `status.py` and `inference-widget.js` accordingly.

**Different instance type** — change `instance_type` in `terraform.tfvars`. CPU instances work for smaller models; swap to a GPU instance type for larger ones.

**Different region** — change `aws_region` in `terraform.tfvars` and confirm your chosen instance type is available there.

**Different DNS provider** — replace the `cloudflare_record` resource in the ephemeral Terraform workspace with your provider's equivalent. Update the provider block in `providers.tf`.

---

## Security Notes

- Port 11434 is restricted to `your_ip` via Security Group — only you can reach the inference endpoint
- The widget's Start/Stop API is protected with Basic Auth via a Lambda Authorizer
- No credentials are stored in this repo — all secrets go in Terraform Cloud environment variables or AWS SSM
- EC2 instances are **terminated**, not stopped — no data persists between sessions

---

## Cost

| Resource | Cost |
|---|---|
| EC2 (c5.2xlarge, ap-south-1) | ~$0.10/hr while running |
| Lambda + API Gateway | Effectively free (free tier) |
| Terraform Cloud | Free (up to 500 resources) |
| Cloudflare DNS | Free |
| **Idle cost** | **$0** |

You pay only for the hours the instance is actually running.

---

## License

MIT — see [LICENSE](LICENSE).