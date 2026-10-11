# Agent Instructions — inference-on-demand

## Project Overview

`inference-on-demand` is an open source project for running **ephemeral, private LLM inference on AWS**. It spins up an EC2 instance when needed and destroys it when done — no always-on servers, no idle costs.

AWS EC2 is the reference compute implementation. The provider abstraction (`api/providers/`) makes it portable to other clouds and compute environments without touching orchestration logic.

---

## Architecture

```
Browser (embeddable widget / control plane UI)
    ├── Start/Stop → API Gateway → Lambda → boto3 run_instances() / terminate_instances()
    │
    └── Inference → direct HTTP to http://<ec2-public-ip>:11434 (non-streaming)
```

- **Persistent infra:** Terraform (`deploy/aws/`), applied once via Terraform CLI in **Local execution mode**. Terraform Cloud stores remote state only — the actual `plan`/`apply` runs on the developer's machine. The Lambda packaging step (`./scripts/build-lambda.sh`) is executed outside Terraform before `terraform plan`/`apply` to ensure exact checksums at plan time. AWS credentials must be exported locally (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`) before running `terraform apply`.
- **EC2 lifecycle:** `api/providers/aws_ec2.py` via boto3 — `run_instances`, `describe_instances`, `terminate_instances`
- **Instance lookup:** Tag-based (`ManagedBy=inference-on-demand`) — no runtime state in SSM
- **Inference traffic:** Client apps call Ollama directly on port 11434 — Lambda is never in the inference path
- **EC2:** Terminated (not stopped) after use — truly ephemeral, new public IP on every launch

---

## Modularity

| Axis | Interface | Reference Implementation | Future Examples |
|---|---|---|---|
| Cloud compute | `api/providers/base.py` | `aws_ec2.py` (boto3) | `aws_ecs.py`, `gcp_compute.py`, `azure_vm.py` |
| IaC deployment | `deploy/<cloud>/` | `deploy/aws/` (Terraform) | `deploy/azure/`, `deploy/gcp/` |

---

## Tech Stack

| Layer | Choice |
|---|---|
| Language | Python |
| Persistent infra | Terraform (HCL) — `deploy/aws/` |
| State backend | Terraform Cloud |
| Compute lifecycle | boto3 (AWS SDK) via `api/providers/aws_ec2.py` |
| Runtime config + secrets | AWS SSM Parameter Store |
| Frontend | Plain HTML + CSS + JavaScript + Bootstrap |
| Auth | Basic Auth via Lambda Authorizer |
| Inference runtime | Ollama (pre-installed on custom AMI) |
| Inference mode | Non-streaming (`"stream": false`) |
| Ollama endpoint | `/api/generate` (single-turn) or `/api/chat` (with role separation) |

---

## Repo Structure

```
inference-on-demand/
├── AGENTS.md
├── architecture/
│   ├── c1-system-context.md        # System context (AWS)
│   ├── c2-container.md             # Container view (AWS)
│   ├── c3-widget-components.md     # Widget internals
│   ├── sequence-e2e.md             # End-to-end sequence (AWS)
│   ├── state-diagram.md            # Widget state machine
│   ├── provider-architecture.md    # Provider abstraction layers
│   └── aws/
│       └── deployment-aws.md       # AWS Terraform deployment diagram
├── deploy/
│   └── aws/                        # Terraform — AWS persistent resources
│       ├── main.tf
│       ├── variables.tf
│       ├── outputs.tf
│       ├── providers.tf
│       └── ui/                     # Terraform — Decoupled S3 UI static hosting
│           ├── main.tf
│           ├── variables.tf
│           ├── outputs.tf
│           └── README.md
├── api/
│   ├── start.py                    # Orchestration — compute launch
│   ├── stop.py                     # Orchestration — compute terminate
│   ├── status.py                   # Orchestration — compute state & IP query
│   ├── authorizer.py               # Basic Auth Lambda Authorizer
│   └── providers/
│       ├── base.py                 # Abstract ComputeProvider
│       └── aws_ec2.py              # boto3 EC2 implementation
├── widget/
│   ├── index.html                  # Control plane dashboard
│   ├── app.js                      # Control plane state machine & logic
│   ├── styles.css                  # Control plane styles
│   ├── inference-widget.js         # Embeddable JS widget
│   └── demo.html                   # Standalone test page
├── scripts/
│   ├── build-lambda.sh             # Build Lambda package
│   ├── build-lambda.ps1            # Build Lambda package (PowerShell)
│   └── build-ami.sh                # One-time AMI build script
├── .gitignore
├── LICENSE
└── README.md
```

---

## Provider Interfaces

### ComputeProvider (`api/providers/base.py`)

```python
class ComputeProvider:
    def launch_instance(self, config: dict) -> str:
        """Launch a compute instance. Returns a handle (e.g. instance_id)."""

    def terminate_instance(self, handle: str) -> None:
        """Terminate the instance identified by handle."""

    def get_state(self, handle: str) -> str:
        """Return current state: 'pending' | 'running' | 'terminated'"""

    def get_ip(self, handle: str) -> str:
        """Return the public IP of the running instance."""
```

---

## Key Design Decisions

### Orchestration Never Contains Provider-Specific Code
`start.py`, `stop.py`, `status.py` call provider interfaces only. boto3 imports do not appear in orchestration files. Provider-specific code lives exclusively in `api/providers/`.

### Tag-Based Instance Lookup
EC2 instances are tagged `ManagedBy=inference-on-demand` at launch. `stop.py` and `status.py` find the active instance by querying this tag via `describe_instances`. No instance ID is stored in SSM between sessions.

### No Runtime State in SSM
SSM holds only static config and secrets. The live system is the state — EC2 queried via tag. Nothing is written to SSM at runtime.

### SSM Parameter Store — Config and Secrets Only

| Parameter | Type | Purpose |
|---|---|---|
| `/inference-on-demand/ami-id` | String | AMI to boot EC2 from |
| `/inference-on-demand/instance-type` | String | EC2 instance type |
| `/inference-on-demand/subnet-id` | String | Public subnet for EC2 |
| `/inference-on-demand/security-group-id` | String | Security Group for EC2 |
| `/inference-on-demand/compute-provider` | String | Provider name e.g. `aws_ec2` |
| `/inference-on-demand/basic-auth-user` | SecureString | Widget auth username |
| `/inference-on-demand/basic-auth-password` | SecureString | Widget auth password |

### Ephemeral by Design
- EC2 instances are **terminated**, never stopped
- Every Start provisions a fresh instance from the custom AMI
- Every Stop terminates the instance

### Inference is Direct and Non-Streaming
- Client apps call Ollama directly at `http://<ec2-public-ip>:11434`
- All inference calls use `"stream": false` — complete JSON response, no SSE
- Use `/api/generate` for single-turn; `/api/chat` when role separation is needed
- Do not implement streaming

### Widget State Machine
`UNKNOWN → TERMINATED → STARTING → READY → STOPPING`
- Error transitions: launch failure → TERMINATED; stop failure → READY
- UNKNOWN is transient — resolved on page load via `GET /status`

### Two-Stage Polling
Do not collapse these:
1. **EC2 Poller** — polls `GET /status` every 5s until `describe_instances` returns `running` and provides a public IP
2. **Ollama Health Poller** — polls `:11434` directly every 5s until 200 OK

EC2 `running` ≠ Ollama ready. ~30–60s gap while model loads.

---

## How to Add a New Compute Provider

1. Create `api/providers/<name>.py`
2. Extend `ComputeProvider` from `api/providers/base.py`
3. Implement: `launch_instance`, `terminate_instance`, `get_state`, `get_ip`
4. Register in `_build_compute_provider` in orchestration handlers
5. Add `deploy/<cloud>/` with IaC config
6. Add `architecture/<cloud>/` with provider-specific diagrams

---

## Architecture Reference

Read the relevant diagram before writing any new code.

| File | What it covers |
|---|---|
| `architecture/c1-system-context.md` | System context — AWS actors and relationships |
| `architecture/c2-container.md` | All containers — AWS services, Lambda functions, providers |
| `architecture/c3-widget-components.md` | Widget internals and state machine components |
| `architecture/sequence-e2e.md` | End-to-end flow — boto3 and SSM calls |
| `architecture/state-diagram.md` | Widget state transitions |
| `architecture/provider-architecture.md` | Provider abstraction layers — how to extend |
| `architecture/aws/deployment-aws.md` | deploy/aws/ Terraform structure |

Update the relevant diagram in the same commit as any code change.

---

## Coding Conventions

- **Python:** PEP 8. `start.py`, `stop.py`, `status.py` contain no provider-specific imports — only interface calls.
- **Terraform:** `variables.tf` for all inputs, `outputs.tf` for all outputs. No hardcoded values in `main.tf`.
- **JavaScript:** Vanilla JS only. No frameworks. Bootstrap for styling.
- **Secrets:** Never committed. SSM Parameter Store for all runtime secrets. Add `*.tfvars` and `.env` to `.gitignore`.
- **Comments:** Explain *why*, not *what*.

---

## Documentation & Writing Conventions

- **Non-retroactive & self-standing:** Write documentation and architecture specifications in a neutral, self-contained, and forward-looking manner describing the current system state. Avoid retroactive commentary, historical comparisons, or changelog-style narratives explaining previous designs or why past approaches were removed.
- **Single source of truth:** Specifications and guides must be directly actionable as standalone references without requiring historical context.

---

## What to Avoid

- Do not write retroactive documentation (e.g. "earlier we used X, but now we use Y") — keep documentation self-contained and focused on the current design

- Do not put boto3 calls in `start.py`, `stop.py`, or `status.py` — use provider interfaces
- Do not store runtime state (instance ID) in SSM — use tag-based lookup
- Do not proxy inference through Lambda — timeout limitations make this unworkable
- Do not implement streaming — non-streaming is the intentional design for app-to-app use
- Do not stop EC2 instances — always terminate
- Do not hardcode AWS account IDs, credentials, or IPs anywhere in source
- Do not collapse the two polling phases — EC2 running and Ollama ready are separate concerns
- Do not introduce framework dependencies in the widget unless absolutely necessary
- Do not switch Terraform Cloud execution mode back to Remote — the build and packaging step requires local access to `api/`, which remote workers do not have
- Do not run `pip install` inside Terraform via provisioners — run `./scripts/build-lambda.sh` before running Terraform commands
