# inference-on-demand

Ephemeral, private LLM inference on AWS — spins up when you need it, gone when you don't.

No always-on servers. No idle costs. One click to start, one click to destroy.

---

## How It Works

```
Browser Widget
    ├── [Start] → API Gateway → Lambda → boto3 (run_instances) + Cloudflare API (create A record)
    │                               ↓
    │                       EC2 boots from custom AMI
    │                       Ollama starts automatically
    │                       ollama.yourdomain.com → EC2 public IP
    │
    └── [Ready] → inference calls go direct to ollama.yourdomain.com:11434
```

```
Browser Widget
    └── [Stop] → API Gateway → Lambda → boto3 (terminate_instances) + Cloudflare API (delete A record)
                                    ↓
                            EC2 terminated
                            DNS record removed
```

Lambda manages the full lifecycle directly — no Terraform at runtime. The browser widget handles the rest.

---

## Use Cases & Cost

This project is built for **single-user, app-to-app inference workflows** where you need a private LLM endpoint on demand — not a shared service, not a chatbot, not something that runs 24/7.

**Why not just use OpenAI / Anthropic / Gemini?**

You might not want your data leaving your infrastructure. Or you want zero per-token cost at inference time. Or you simply want full control over the model.

**Cost:**

| Resource | Cost |
|---|---|
| EC2 (size depends on your model — see [Adapting This Project](#adapting-this-project)) | Pay only while running |
| Lambda + API Gateway | Effectively free (free tier) |
| Terraform Cloud | Free (up to 500 resources) |
| Cloudflare DNS | Free |
| **Idle cost** | **$0** |

You pay only for the time the instance is actually running. A typical session of a few hours costs cents.

---

## Prerequisites

- AWS account
- Cloudflare account with a domain
- Terraform Cloud account (free tier is fine)
- Terraform CLI installed locally (for one-time infra deployment)

---

## Project Structure

```
inference-on-demand/
├── .github/
│   └── copilot-instructions.md
├── architecture/               # Architecture diagrams (Mermaid)
│   ├── c1-system-context.md
│   ├── c2-container.md
│   ├── c3-widget-components.md
│   ├── sequence-e2e.md
│   └── state-diagram.md
├── infra/                      # Terraform — persistent resources (one-time deploy)
│   ├── main.tf                 # IAM, Security Group, API Gateway, Lambda
│   ├── variables.tf
│   ├── outputs.tf
│   └── providers.tf
├── lambda/                     # Python — lifecycle triggers
│   ├── authorizer.py           # Basic Auth Lambda Authorizer
│   ├── start.py                # boto3 run_instances + Cloudflare create A record
│   ├── stop.py                 # boto3 terminate_instances + Cloudflare delete A record
│   └── status.py               # describe_instances + Ollama health check
├── widget/
│   ├── inference-widget.js     # Embeddable JS widget
│   └── demo.html               # Standalone test page
├── scripts/
│   └── build-ami.sh            # One-time AMI build script
└── README.md
```

---

## Setup

For step-by-step setup instructions, see [ADOPTION.md](ADOPTION.md).

---

## Adapting This Project

This project is intentionally not tied to a specific model, runtime, or instance size. To adapt it:

**Different model** — modify `build-ami.sh` to pull a different model before snapshotting.

**Different inference runtime** — replace Ollama with any runtime that exposes an HTTP API. Update the health check URL in `status.py` and `inference-widget.js` accordingly.

**Instance size** — choose based on your model's requirements. Smaller models (1B–3B) run comfortably on CPU instances with 16GB RAM. Larger models benefit from more RAM or a GPU instance. Change the `instance_type` SSM parameter.

**Different region** — update the `aws_region` variable in `infra/terraform.tfvars` and the AWS region in your SSM parameters.

**Different DNS provider** — replace the Cloudflare API calls in `start.py` and `stop.py` with your provider's equivalent HTTP API. Update the health check in `status.py` accordingly.

---

## Security Notes

- The widget's Start/Stop API is protected with Basic Auth via a Lambda Authorizer
- No credentials are stored in this repo — all secrets go in Terraform Cloud environment variables or AWS SSM
- EC2 instances are **terminated**, not stopped — no data persists between sessions

---

## License

MIT — see [LICENSE](LICENSE).
