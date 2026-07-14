# Copilot Instructions — inference-on-demand

## Project Overview

`inference-on-demand` is an open source project for running **ephemeral, private LLM inference on AWS**. It spins up a cloud instance when needed and destroys it when done — no always-on servers, no idle costs.

Persistent infrastructure (Lambda, API Gateway, IAM, Security Group) is deployed once via Terraform. EC2 lifecycle and DNS are managed directly by Lambda at runtime using boto3 and the Cloudflare API — no Terraform at runtime.

---

## Architecture

```
Browser (embeddable widget)
    ├── Start/Stop → API Gateway → Lambda → boto3 + Cloudflare API
    │                                           ↓
    │                               EC2 instance (custom AMI, Ollama pre-installed)
    │                               Cloudflare A record → EC2 public IP
    │
    └── Inference → direct HTTP to ollama.yourdomain.com:11434 (non-streaming)
```

- **Persistent infra:** Terraform (`infra/`), applied once locally via Terraform CLI
- **EC2 lifecycle:** `start.py` calls `boto3.run_instances()`, `stop.py` calls `boto3.terminate_instances()`
- **DNS lifecycle:** `start.py` calls Cloudflare API to create A record, `stop.py` calls Cloudflare API to delete it
- **State tracking:** Lambda writes `{ instance_id, dns_record_id }` to SSM Parameter Store after start; reads on stop
- **Inference traffic:** Client apps call Ollama directly on port 11434 — Lambda is never in the inference path
- **EC2:** Terminated (not stopped) after use — truly ephemeral, new public IP on every launch
- **No Elastic IP** — dynamic IP resolved via Cloudflare A record on each start

---

## Tech Stack

| Layer | Choice |
|---|---|
| Language | Python |
| Persistent infra | Terraform (HCL) |
| State backend | Terraform Cloud |
| EC2 lifecycle | boto3 (AWS SDK for Python) |
| DNS lifecycle | Cloudflare API (HTTP, via `requests`) |
| Runtime state | AWS SSM Parameter Store |
| Cloud provider | AWS (Mumbai — ap-south-1) |
| DNS | Cloudflare |
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
├── infra/                      # Terraform — persistent resources (one-time deploy)
│   ├── main.tf                 # IAM, Security Group, API Gateway, Lambda
│   ├── variables.tf
│   ├── outputs.tf
│   └── providers.tf
├── lambda/                     # Python Lambda functions
│   ├── authorizer.py           # Basic Auth Lambda Authorizer
│   ├── start.py                # boto3 run_instances + Cloudflare create A record
│   ├── stop.py                 # boto3 terminate_instances + Cloudflare delete A record
│   └── status.py               # describe_instances + Ollama health check
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

### No Terraform at Runtime
Terraform is only used for persistent infra (`infra/`), applied once. EC2 and DNS are managed directly by Lambda via boto3 and Cloudflare API. This avoids the overhead of Terraform Cloud API-driven workspaces, config tarball uploads, and 2-3 minute plan+apply cycles per session.

### Runtime State in SSM
`start.py` writes `{ instance_id, dns_record_id }` to SSM Parameter Store after provisioning. `stop.py` reads these to know what to terminate and delete. SSM is the lightweight state store — no database, no external service.

### SSM-Driven Config
All runtime config is stored in SSM Parameter Store and read by Lambda at startup. Nothing is hardcoded.

| SSM Parameter | Purpose |
|---|---|
| `/inference-on-demand/ami-id` | AMI to boot EC2 from |
| `/inference-on-demand/instance-type` | EC2 instance type |
| `/inference-on-demand/subnet-id` | Public subnet for EC2 |
| `/inference-on-demand/security-group-id` | Security Group for EC2 |
| `/inference-on-demand/cf-token` | Cloudflare API token |
| `/inference-on-demand/cf-zone-id` | Cloudflare Zone ID |
| `/inference-on-demand/cf-subdomain` | Subdomain (e.g. `inference`) |
| `/inference-on-demand/cf-domain` | Domain (e.g. `yourdomain.com`) |
| `/inference-on-demand/basic-auth-user` | Widget auth username |
| `/inference-on-demand/basic-auth-password` | Widget auth password |
| `/inference-on-demand/active-instance-id` | Written by start.py, read by stop.py |
| `/inference-on-demand/active-dns-record-id` | Written by start.py, read by stop.py |

### Ephemeral by Design
- EC2 instances are **terminated**, never stopped
- Every Start provisions a fresh instance from the custom AMI
- Every Stop terminates the instance and deletes the Cloudflare A record

### No Elastic IP
- `start.py` gets the public IP from `describe_instances` after the instance is running
- Creates a Cloudflare A record pointing to that IP (TTL 60s)
- `stop.py` deletes the A record using the stored `dns_record_id`

### Inference is Direct and Non-Streaming
- Client apps call Ollama directly at `ollama.yourdomain.com:11434`
- All inference calls use `"stream": false`
- Primary use case is app-to-app (extraction, classification, summarisation), not interactive chat
- Use `/api/generate` for raw single-turn prompts; `/api/chat` when role separation is needed
- Do not implement streaming

### Widget State Machine
Five states: `UNKNOWN → TERMINATED → STARTING → READY → STOPPING`

- **UNKNOWN:** Transient. Widget calls `GET /status` on load and resolves immediately.
- **TERMINATED:** No active instance. Shows [▶ Start] button.
- **STARTING:** EC2 boot in progress. Two polling phases. Shows [Starting...] (disabled).
- **READY:** Ollama responding. Shows [■ Stop] + endpoint URL. Fires `ollamaReady` CustomEvent.
- **STOPPING:** Termination in progress. Shows [Stopping...] (disabled). Fires `ollamaOffline` on completion.

Error transitions: start failure → TERMINATED; stop failure → READY.

### Two-Stage Polling
Do not collapse these into one:
1. **EC2 Poller** — polls `GET /status` every 5s until `describe_instances` returns `running` state + public IP
2. **Ollama Health Poller** — polls `GET ollama.yourdomain.com:11434/` every 5s until 200 OK

EC2 `running` ≠ Ollama ready. There is a ~30–60s gap while the model loads.

### Widget is the Source of Truth
- Fires `CustomEvent('ollamaReady', { detail: { endpoint } })` on `window` when ready
- Fires `CustomEvent('ollamaOffline')` on `window` when stopped
- Host apps only listen for these events — they never hardcode the endpoint or IP

---

## Lambda Function Responsibilities

### `start.py`
1. Read config from SSM (AMI ID, instance type, subnet, security group, CF token, zone ID, subdomain, domain)
2. Call `boto3.run_instances()` to launch EC2
3. Poll `describe_instances()` until state is `running` and public IP is available
4. Call Cloudflare API `POST /zones/{zone_id}/dns_records` to create A record
5. Write `instance_id` and `dns_record_id` to SSM
6. Return `{ status: "starting", ip: "x.x.x.x" }`

### `stop.py`
1. Read `instance_id` and `dns_record_id` from SSM
2. Call Cloudflare API `DELETE /zones/{zone_id}/dns_records/{record_id}` to remove A record
3. Call `boto3.terminate_instances()` to terminate EC2
4. Clear `instance_id` and `dns_record_id` from SSM
5. Return `{ status: "stopping" }`

### `status.py`
1. Read `instance_id` from SSM
2. If no instance ID → return `{ status: "terminated" }`
3. Call `describe_instances()` → return current EC2 state
4. If state is `running` → also return public IP

### `authorizer.py`
1. Read Basic Auth credentials from SSM
2. Decode `Authorization` header from request
3. Return Allow or Deny policy

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
| IAM Role + Policy | Terraform (`infra/`) | Persistent |
| Security Group | Terraform (`infra/`) | Persistent |
| API Gateway | Terraform (`infra/`) | Persistent |
| Lambda functions | Terraform (`infra/`) | Persistent |
| EC2 instance | `start.py` / `stop.py` (boto3) | Ephemeral |
| Cloudflare A record | `start.py` / `stop.py` (CF API) | Ephemeral |
| Active instance state | SSM Parameter Store | Ephemeral (written/cleared per session) |

---

## Architecture Reference

All architecture diagrams live in `architecture/` as Mermaid markdown files. Read the relevant diagram before writing any new code.

| File | What it covers |
|---|---|
| `architecture/c1-system-context.md` | System boundaries and external actors |
| `architecture/c2-container.md` | All containers and how they communicate |
| `architecture/c3-widget-components.md` | Internal components of `inference-widget.js` |
| `architecture/sequence-e2e.md` | End-to-end user interaction and message flow |
| `architecture/state-diagram.md` | Widget state machine and all transitions |

When design decisions change, update the relevant diagram in the same commit as the code change.

---

## Coding Conventions

- **Python:** Follow PEP 8. Lambda handlers are single-file, no unnecessary dependencies. Use `boto3` for AWS calls, `requests` for Cloudflare API calls.
- **Terraform:** Use `variables.tf` for all inputs, `outputs.tf` for all outputs. No hardcoded values in `main.tf`.
- **JavaScript:** Vanilla JS only. No frameworks. Bootstrap for styling.
- **Secrets:** Never committed. Use SSM Parameter Store for all runtime secrets. Add `*.tfvars` and `.env` to `.gitignore`.
- **Comments:** Explain *why*, not *what*.

---

## What to Avoid

- Do not use Terraform to manage EC2 or DNS at runtime — boto3 and Cloudflare API are intentional
- Do not proxy inference through Lambda — timeout limitations make this unworkable
- Do not implement streaming responses — non-streaming is the intentional design for app-to-app use
- Do not hardcode AWS account IDs, Cloudflare zone IDs, domain names, or credentials anywhere in source
- Do not stop EC2 instances — always terminate
- Do not introduce framework dependencies in the widget (React, Vue etc.) unless absolutely necessary
- Do not collapse the two polling phases into one — EC2 running and Ollama ready are separate concerns
- Do not add Elastic IP — dynamic IP via Cloudflare A record is intentional