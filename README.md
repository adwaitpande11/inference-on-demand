# inference-on-demand

Ephemeral, private LLM inference on AWS — spins up when you need it, gone when you don't.

No always-on servers. No idle costs. One click to start, one click to destroy.

> Built on AWS EC2 as the reference compute implementation. The provider abstraction makes it portable — see [Provider Architecture](architecture/provider-architecture.md) to add support for other clouds or compute environments.

---

## How It Works

```
Browser / Control Plane UI
    ├── [Start] → API Gateway → Lambda → boto3 run_instances()
    │                                  ↓
    │                          EC2 boots from custom AMI
    │                          Ollama starts automatically
    │
    └── [Ready] → inference calls go direct to http://<ec2-public-ip>:11434
```

```
Browser / Control Plane UI
    └── [Stop] → API Gateway → Lambda → boto3 terminate_instances()
                                       ↓
                               EC2 terminated
```

Lambda manages the compute lifecycle directly via boto3. No Terraform at runtime.

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
| **Idle cost** | **$0** |

You pay only for the time the instance is actually running. A typical session of a few hours costs cents.

---

## Prerequisites

- AWS account
- Terraform Cloud account (free tier is fine)
- Terraform CLI installed locally
- Python 3.12+ installed locally

---

## Project Structure

```
inference-on-demand/
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
│       ├── providers.tf
│       └── ui/                         # Terraform — Decoupled S3 UI static hosting
│           ├── main.tf
│           ├── variables.tf
│           ├── outputs.tf
│           └── README.md
├── api/
│   ├── start.py                        # Launch EC2 instance
│   ├── stop.py                         # Terminate EC2 instance
│   ├── status.py                       # EC2 state & public IP query
│   ├── authorizer.py                   # Basic Auth
│   └── providers/
│       ├── base.py                     # Abstract ComputeProvider
│       └── aws_ec2.py                  # boto3 EC2 implementation
├── widget/
│   ├── index.html                      # Control plane dashboard
│   ├── app.js                          # Control plane state machine & logic
│   ├── styles.css                      # Control plane styles
│   ├── inference-widget.js             # Embeddable JS widget
│   └── demo.html                       # Standalone test page
├── scripts/
│   ├── build-lambda.sh                 # Build Lambda package
│   ├── build-lambda.ps1                # Build Lambda package (PowerShell)
│   └── build-ami.sh                    # One-time AMI build script
└── README.md
```

---

## Control Plane UI

A lightweight, single-user control plane web interface is available under `widget/`:
- **Local Run:** Open `widget/index.html` directly in any modern browser. Enter your API Gateway URL and Basic Auth credentials.
- **AWS S3 Static Hosting:** Deploy to a decoupled S3 website bucket with zero idle compute cost. See [deploy/aws/ui/README.md](deploy/aws/ui/README.md) for deployment instructions.

---

## Setup

For step-by-step setup instructions, see [ADOPTION.md](ADOPTION.md).

---

## Adapting This Project

**Different model** — modify `scripts/build-ami.sh` to pull a different model before snapshotting.

**Different inference runtime** — replace Ollama with any runtime that exposes an HTTP API. Update the health check in `api/status.py` and `widget/inference-widget.js`.

**Instance size** — choose based on your model. Smaller models (1B–3B) run comfortably on CPU instances with 16GB RAM. Larger models benefit from more RAM or a GPU instance. Set `instance_type` in SSM Parameter Store.

**Different cloud provider** — implement `ComputeProvider` from `api/providers/base.py`. See [Provider Architecture](architecture/provider-architecture.md).

---

## Security Notes

- The control plane Start/Stop API is protected with Basic Auth via a Lambda Authorizer
- No credentials are stored in this repo — all secrets go in AWS SSM Parameter Store or Terraform Cloud environment variables
- EC2 instances are **terminated**, not stopped — no data persists between sessions

---

## License

MIT — see [LICENSE](LICENSE).