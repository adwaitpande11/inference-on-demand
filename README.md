# inference-on-demand

Ephemeral, private LLM inference on AWS — spins up when you need it, gone when you don't.

No always-on servers. No idle costs. One click to start, one click to destroy.

> Built on AWS with Cloudflare DNS as the reference implementation. The provider abstraction makes it portable — see [Provider Architecture](architecture/provider-architecture.md) to add support for other clouds or DNS providers.

---

## How It Works

```
Browser Widget
    ├── [Start] → API Gateway → Lambda → boto3 run_instances()
    │                                  → Cloudflare API create A record
    │                               ↓
    │                       EC2 boots from custom AMI
    │                       Ollama starts automatically
    │                       inference.yourdomain.com → EC2 public IP
    │
    └── [Ready] → inference calls go direct to inference.yourdomain.com:11434
```

```
Browser Widget
    └── [Stop] → API Gateway → Lambda → Cloudflare API delete A record
                                      → boto3 terminate_instances()
                                   ↓
                           EC2 terminated
                           DNS record removed
```

Lambda manages the full lifecycle directly via boto3 and the Cloudflare API. No Terraform at runtime.

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
- Terraform CLI installed locally

---

## Project Structure

```
inference-on-demand/
├── .github/
│   └── copilot-instructions.md
├── architecture/
│   ├── c1-system-context.md            # System context
│   ├── c2-container.md                 # Container view (AWS)
│   ├── c3-widget-components.md         # Widget internals
│   ├── sequence-e2e.md                 # End-to-end sequence (AWS)
│   ├── state-diagram.md                # Widget state machine
│   ├── provider-architecture.md        # Provider abstraction layers
│   └── aws/
│       └── deployment-aws.md           # AWS Terraform deployment diagram
├── deploy/
│   └── aws/                            # Terraform — AWS persistent resources
│       ├── main.tf
│       ├── variables.tf
│       ├── outputs.tf
│       └── providers.tf
├── api/
│   ├── start.py                        # Launch EC2 + create DNS record
│   ├── stop.py                         # Delete DNS record + terminate EC2
│   ├── status.py                       # EC2 state + Ollama health
│   ├── authorizer.py                   # Basic Auth
│   ├── providers/
│   │   ├── base.py                     # Abstract ComputeProvider
│   │   └── aws_ec2.py                  # boto3 EC2 implementation
│   └── dns/
│       ├── base.py                     # Abstract DNSProvider
│       └── cloudflare.py               # Cloudflare HTTP API implementation
├── widget/
│   ├── inference-widget.js             # Embeddable JS widget
│   └── demo.html                       # Standalone test page
├── scripts/
│   └── build-ami.sh                    # One-time AMI build script
└── README.md
```

---

## Setup

For step-by-step setup instructions, see [ADOPTION.md](ADOPTION.md).

---

## Adapting This Project

**Different model** — modify `scripts/build-ami.sh` to pull a different model before snapshotting.

**Different inference runtime** — replace Ollama with any runtime that exposes an HTTP API. Update the health check in `api/status.py` and `widget/inference-widget.js`.

**Instance size** — choose based on your model. Smaller models (1B–3B) run comfortably on CPU instances with 16GB RAM. Larger models benefit from more RAM or a GPU instance. Set `instance_type` in SSM Parameter Store.

**Different cloud provider** — implement `ComputeProvider` from `api/providers/base.py`. See [Provider Architecture](architecture/provider-architecture.md).

**Different DNS provider** — implement `DNSProvider` from `api/dns/base.py`. See [Provider Architecture](architecture/provider-architecture.md).

---

## Security Notes

- The widget's Start/Stop API is protected with Basic Auth via a Lambda Authorizer
- No credentials are stored in this repo — all secrets go in AWS SSM Parameter Store or Terraform Cloud environment variables
- EC2 instances are **terminated**, not stopped — no data persists between sessions

---

## License

MIT — see [LICENSE](LICENSE).