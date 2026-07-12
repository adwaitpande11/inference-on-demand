# Copilot Instructions — inference-on-demand

## Project Overview

`inference-on-demand` is an open source project for running **ephemeral, private LLM inference on AWS**. It spins up a cloud instance when needed and destroys it when done — no always-on servers, no idle costs.

The full lifecycle is managed by Terraform. A lightweight embeddable widget in client apps triggers start and stop via the Terraform Cloud API.

---

## Architecture

```
Browser (embeddable widget)
    ├── Start/Stop → API Gateway → Lambda → Terraform Cloud API → terraform apply / destroy
    │                                               ↓
    │                                       EC2 instance (custom AMI, Ollama + model pre-installed)
    │                                       Cloudflare A record → ec2.public_ip output
    │
    └── Inference → direct HTTP to ollama.yourdomain.com:11434 (Ollama API, non-streaming)
```

- **Lifecycle management:** Terraform Cloud (remote state + apply/destroy runs)
- **DNS:** Cloudflare provider, A record wired to EC2 public IP output — updated on every `terraform apply`
- **Inference traffic:** Client apps call Ollama directly on port 11434 — does NOT proxy through Lambda (avoids timeout limitations)
- **EC2:** Terminated (not stopped) after use — truly ephemeral, new public IP on every launch
- **No Elastic IP** — dynamic IP is resolved via Cloudflare on each apply

---

## Tech Stack

| Layer | Choice |
|---|---|
| Language | Python |
| Infrastructure | Terraform (HCL) |
| State backend | Terraform Cloud |
| Cloud provider | AWS (Mumbai — ap-south-1) |
| Instance type | c5.2xlarge (CPU inference) |
| DNS | Cloudflare |
| Lifecycle trigger | Terraform Cloud API (via Lambda) |
| Frontend | Plain HTML + CSS + JavaScript + Bootstrap |
| Auth | Basic Auth via Lambda Authorizer |
| Inference runtime | Ollama (pre-installed on custom AMI) |
| Inference mode | Non-streaming (`"stream": false`) |
| Ollama endpoint | `/api/generate` (single-turn) or `/api/chat` (with role separation) |

---

## Repo Structure

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
├── infra/                      # Terraform — persistent resources
│   ├── main.tf
│   ├── variables.tf
│   ├── outputs.tf
│   └── providers.tf
├── lambda/                     # Python Lambda functions
│   ├── authorizer.py           # Basic Auth Lambda Authorizer
│   ├── start.py                # Triggers terraform apply via TF Cloud API
│   ├── stop.py                 # Triggers terraform destroy via TF Cloud API
│   └── status.py               # Returns current run status + Ollama readiness
├── widget/                     # Embeddable frontend
│   ├── inference-widget.js     # Self-contained JS widget
│   └── demo.html               # Standalone demo/test page
├── scripts/
│   └── build-ami.sh            # One-time AMI build script
├── .gitignore
├── LICENSE                     # MIT
└── README.md
```

---

## Key Design Decisions

### Ephemeral by Design
- EC2 instances are **terminated**, never stopped
- Every `terraform apply` provisions a fresh instance from the custom AMI
- Every `terraform destroy` removes the instance and the Cloudflare DNS record together

### No Elastic IP
- The Cloudflare A record is set to `aws_instance.ollama.public_ip` — a direct Terraform output chain
- No EIP means no cost when the instance is down
- DNS TTL is set to 60 seconds to minimise propagation lag on each apply

### Inference is Direct and Non-Streaming
- Client apps call Ollama directly at `ollama.yourdomain.com:11434` — Lambda is never in the inference path
- All inference calls use `"stream": false` — the API holds the connection and returns a complete JSON response
- This is intentional: the primary use case is app-to-app (extraction, classification, summarisation), not interactive chat
- Use `/api/generate` for raw single-turn prompts; use `/api/chat` when system/user/assistant role separation is needed
- Do not implement streaming — it adds SSE/ReadableStream complexity with no benefit for the target use case

### Ollama API Endpoints
- `/api/generate` — raw prompt in, raw completion out. Simpler request shape. Good for single-turn tasks.
- `/api/chat` — structured messages with roles (system/user/assistant). Good for system prompt separation.
- Both support `"stream": false`. Client apps should always set this explicitly.

### Widget State Machine
The widget has five states: `UNKNOWN → TERMINATED → STARTING → READY → STOPPING`

- **UNKNOWN:** Transient. Widget calls `GET /status` on load and immediately resolves to TERMINATED or READY.
- **TERMINATED:** No active instance. Shows [▶ Start] button.
- **STARTING:** Apply run in progress. Two polling phases — Terraform run poller (via `/status`), then Ollama health poller (direct to `:11434`). Shows [Starting...] (disabled).
- **READY:** Ollama responding. Shows [■ Stop] button + endpoint URL. Fires `ollamaReady` CustomEvent on `window`.
- **STOPPING:** Destroy run in progress. Shows [Stopping...] (disabled). Fires `ollamaOffline` on completion.

Error transitions: apply failure → TERMINATED; destroy failure → READY.

### Two-Stage Polling
Polling during STARTING is split into two distinct phases — do not collapse them:
1. **Terraform Run Poller** — polls `GET /status` every 5s until Terraform apply completes and EC2 is `running`
2. **Ollama Health Poller** — polls `GET ollama.yourdomain.com:11434/` every 5s until Ollama returns 200 OK

EC2 `running` in AWS does not mean Ollama is ready. There is a ~30-60 second gap while the model loads.

### Widget is the Source of Truth
- The embeddable widget polls `/status` (Lambda) to track Terraform run state
- Once Ollama responds 200 OK, the widget fires `CustomEvent('ollamaReady', { detail: { endpoint } })` on `window`
- On stop completion, the widget fires `CustomEvent('ollamaOffline')` on `window`
- Host apps only listen for these events — they never hardcode the endpoint, subdomain, or IP

### Security Group
- EC2 has no public SSH access in production
- Ollama is configured with `OLLAMA_HOST=0.0.0.0:11434` and `OLLAMA_ORIGINS=*`

---

## Widget Integration (Host App)

```html
<script
  src="path/to/inference-widget.js"
  data-api-url="https://your-api-gateway-url"
  data-token="your-basic-auth-token">
</script>

<script>
  window.addEventListener('ollamaReady', (e) => {
    const endpoint = e.detail.endpoint;
    // e.g. http://ollama.yourdomain.com:11434
    // call /api/generate or /api/chat with stream: false
  });

  window.addEventListener('ollamaOffline', () => {
    // handle endpoint going away
  });
</script>
```

---

## Persistent vs Ephemeral Resources

| Resource | Managed By | Lifecycle |
|---|---|---|
| IAM Role + Policy | Terraform (infra/) | Persistent |
| Security Group | Terraform (infra/) | Persistent |
| API Gateway | Terraform (infra/) | Persistent |
| Lambda functions | Terraform (infra/) | Persistent |
| SSM Parameters | Terraform (infra/) | Persistent |
| EC2 instance | Terraform (workspace triggered by Lambda) | Ephemeral |
| Cloudflare A record | Terraform (same workspace as EC2) | Ephemeral |

---

## Coding Conventions

- **Python:** Follow PEP 8. Lambda handlers are single-file, no unnecessary dependencies.
- **Terraform:** Use `variables.tf` for all inputs, `outputs.tf` for all outputs. No hardcoded values in `main.tf`.
- **JavaScript:** Vanilla JS only. No frameworks. Bootstrap for styling.
- **Secrets:** Never committed. Use environment variables or SSM Parameter Store. Add `*.tfvars` and `.env` to `.gitignore`.
- **Comments:** Explain *why*, not *what*.

---

## Architecture Reference

All architecture diagrams live in `architecture/` as Mermaid markdown files.
Before writing any new code, read the relevant diagram first.

| File | What it covers |
|---|---|
| `architecture/c1-system-context.md` | System boundaries and external actors |
| `architecture/c2-container.md` | All containers and how they communicate |
| `architecture/c3-widget-components.md` | Internal components of `inference-widget.js` |
| `architecture/sequence-e2e.md` | End-to-end user interaction and message flow |
| `architecture/state-diagram.md` | Widget state machine and all transitions |

When design decisions change, update the relevant diagram in the same commit as the code change.

---

## What to Avoid

- Do not add Elastic IP — dynamic IP via Cloudflare is intentional
- Do not proxy inference through Lambda — timeout limitations make this unworkable
- Do not implement streaming responses — non-streaming is the intentional design for app-to-app use
- Do not hardcode AWS account IDs, Cloudflare zone IDs, domain names, or credentials anywhere in source
- Do not use `terraform stop` — instances must be terminated, not stopped
- Do not introduce framework dependencies in the widget (React, Vue etc.) unless absolutely necessary
- Do not collapse the two polling phases into one — Terraform run state and Ollama readiness are separate concerns

---

## Local Development Notes

- Terraform Cloud workspace must have AWS credentials and Cloudflare API token set as environment variables (not in code)
- The custom AMI ID is stored in SSM Parameter Store and read by Terraform at apply time
- Widget can be tested standalone using `demo.html` — point `data-api-url` at your API Gateway URL
- Architecture diagrams live in `architecture/` as Mermaid markdown files — update them when design decisions change
