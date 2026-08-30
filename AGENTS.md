# Agent Instructions — inference-on-demand

## Project Overview

`inference-on-demand` is an open source project for running **ephemeral, private LLM inference on AWS**. It spins up an EC2 instance when needed and destroys it when done — no always-on servers, no idle costs.

AWS with Cloudflare DNS is the reference implementation. The provider abstraction (`api/providers/`, `api/dns/`) makes it portable to other clouds and DNS services without touching orchestration logic.

---

## Architecture

```
Browser (embeddable widget)
    ├── Start/Stop → API Gateway → Lambda → boto3 run_instances() / terminate_instances()
    │                                     → Cloudflare API create / delete A record
    │
    └── Inference → direct HTTP to inference.yourdomain.com:11434 (non-streaming)
```

- **Persistent infra:** Terraform (`deploy/aws/`), applied once via Terraform CLI in **Local execution mode**. Terraform Cloud stores remote state only — the actual `plan`/`apply` runs on the developer's machine, because the Lambda packaging step (`null_resource.build_lambda_packages`) needs access to the full repo checkout (`api/`), which lives outside `deploy/aws/` and is not available on Terraform Cloud's remote workers. AWS credentials must be exported locally (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`) before running `terraform apply`.
- **EC2 lifecycle:** `api/providers/aws_ec2.py` via boto3 — `run_instances`, `describe_instances`, `terminate_instances`
- **DNS lifecycle:** `api/dns/cloudflare.py` via Cloudflare HTTP API — POST/DELETE/GET on `/dns_records`
- **Instance lookup:** Tag-based (`ManagedBy=inference-on-demand`) — no runtime state in SSM
- **Inference traffic:** Client apps call Ollama directly on port 11434 — Lambda is never in the inference path
- **EC2:** Terminated (not stopped) after use — truly ephemeral, new public IP on every launch
- **No Elastic IP** — dynamic IP resolved via Cloudflare A record (TTL 60s) on each start

---

## Three Axes of Modularity

| Axis | Interface | Reference Implementation | Future Examples |
|---|---|---|---|
| Cloud compute | `api/providers/base.py` | `aws_ec2.py` (boto3) | `aws_ecs.py`, `gcp_compute.py`, `azure_vm.py` |
| DNS | `api/dns/base.py` | `cloudflare.py` (HTTP API) | `route53.py`, `azure_dns.py` |
| IaC deployment | `deploy/<cloud>/` | `deploy/aws/` (Terraform) | `deploy/azure/`, `deploy/gcp/` |

---

## Tech Stack

| Layer | Choice |
|---|---|
| Language | Python |
| Persistent infra | Terraform (HCL) — `deploy/aws/` |
| State backend | Terraform Cloud |
| Compute lifecycle | boto3 (AWS SDK) via `api/providers/aws_ec2.py` |
| DNS lifecycle | Cloudflare HTTP API via `api/dns/cloudflare.py` |
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
│       └── providers.tf
├── api/
│   ├── start.py                    # Orchestration — launch + DNS record create
│   ├── stop.py                     # Orchestration — DNS record delete + terminate
│   ├── status.py                   # Orchestration — EC2 state query
│   ├── authorizer.py               # Basic Auth Lambda Authorizer
│   ├── providers/
│   │   ├── __init__.py             # Provider factory
│   │   ├── base.py                 # Abstract ComputeProvider
│   │   └── aws_ec2.py              # boto3 EC2 implementation
│   └── dns/
│       ├── __init__.py             # DNS provider factory
│       ├── base.py                 # Abstract DNSProvider
│       └── cloudflare.py           # Cloudflare HTTP API implementation
├── widget/
│   ├── inference-widget.js
│   └── demo.html
├── scripts/
│   └── build-ami.sh
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

### DNSProvider (`api/dns/base.py`)

```python
class DNSProvider:
    def create_record(self, name: str, ip: str) -> str:
        """Create an A record pointing name to ip. Returns a record reference."""

    def delete_record(self, ref: str) -> None:
        """Delete the DNS record identified by ref."""
```

---

## Key Design Decisions

### Orchestration Never Contains Provider-Specific Code
`start.py`, `stop.py`, `status.py` call provider interfaces only. boto3 imports, Cloudflare HTTP calls — none of this appears in orchestration files. Provider-specific code lives exclusively in `api/providers/` and `api/dns/`.

### Tag-Based Instance Lookup
EC2 instances are tagged `ManagedBy=inference-on-demand` at launch. `stop.py` and `status.py` find the active instance by querying this tag via `describe_instances`. No instance ID or DNS record ID is stored in SSM between sessions.

### No Runtime State in SSM
SSM holds only static config and secrets. The live systems are the state — EC2 via tag, Cloudflare via subdomain name query. Nothing is written to SSM at runtime.

### SSM Parameter Store — Config and Secrets Only

| Parameter | Type | Purpose |
|---|---|---|
| `/inference-on-demand/ami-id` | String | AMI to boot EC2 from |
| `/inference-on-demand/instance-type` | String | EC2 instance type |
| `/inference-on-demand/subnet-id` | String | Public subnet for EC2 |
| `/inference-on-demand/security-group-id` | String | Security Group for EC2 |
| `/inference-on-demand/compute-provider` | String | Provider name e.g. `aws_ec2` |
| `/inference-on-demand/dns-provider` | String | DNS provider name e.g. `cloudflare` |
| `/inference-on-demand/cf-token` | SecureString | Cloudflare API token |
| `/inference-on-demand/cf-zone-id` | SecureString | Cloudflare Zone ID |
| `/inference-on-demand/cf-subdomain` | String | Subdomain prefix |
| `/inference-on-demand/cf-domain` | String | Root domain |
| `/inference-on-demand/basic-auth-user` | SecureString | Widget auth username |
| `/inference-on-demand/basic-auth-password` | SecureString | Widget auth password |

### Ephemeral by Design
- EC2 instances are **terminated**, never stopped
- Every Start provisions a fresh instance from the custom AMI
- Every Stop terminates the instance and deletes the Cloudflare A record

### No Elastic IP
- `start.py` gets the public IP from `describe_instances` once the instance is `running`
- Creates a Cloudflare A record pointing to that IP (TTL 60s)
- `stop.py` queries Cloudflare by subdomain name to get the record ID, then deletes it

### Inference is Direct and Non-Streaming
- Client apps call Ollama directly at `inference.yourdomain.com:11434`
- All inference calls use `"stream": false` — complete JSON response, no SSE
- Use `/api/generate` for single-turn; `/api/chat` when role separation is needed
- Do not implement streaming

### Widget State Machine
`UNKNOWN → TERMINATED → STARTING → READY → STOPPING`
- Error transitions: launch failure → TERMINATED; stop failure → READY
- UNKNOWN is transient — resolved on page load via `GET /status`

### Two-Stage Polling
Do not collapse these:
1. **EC2 Poller** — polls `GET /status` every 5s until `describe_instances` returns `running`
2. **Ollama Health Poller** — polls `:11434` directly every 5s until 200 OK

EC2 `running` ≠ Ollama ready. ~30–60s gap while model loads.

---

## How to Add a New Compute Provider

1. Create `api/providers/<name>.py`
2. Extend `ComputeProvider` from `api/providers/base.py`
3. Implement: `launch_instance`, `terminate_instance`, `get_state`, `get_ip`
4. Register in `api/providers/__init__.py`
5. Add `deploy/<cloud>/` with IaC config
6. Add `architecture/<cloud>/` with provider-specific diagrams

## How to Add a New DNS Provider

1. Create `api/dns/<name>.py`
2. Extend `DNSProvider` from `api/dns/base.py`
3. Implement: `create_record`, `delete_record`
4. Register in `api/dns/__init__.py`

---

## Architecture Reference

Read the relevant diagram before writing any new code.

| File | What it covers |
|---|---|
| `architecture/c1-system-context.md` | System context — AWS actors and relationships |
| `architecture/c2-container.md` | All containers — AWS services, Lambda functions, providers |
| `architecture/c3-widget-components.md` | Widget internals and state machine components |
| `architecture/sequence-e2e.md` | End-to-end flow — boto3, Cloudflare API, SSM calls |
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

## What to Avoid

- Do not put boto3 or Cloudflare API calls in `start.py`, `stop.py`, or `status.py` — use provider interfaces
- Do not store runtime state (instance ID, DNS record ID) in SSM — use tag-based and name-based lookup
- Do not proxy inference through Lambda — timeout limitations make this unworkable
- Do not implement streaming — non-streaming is the intentional design for app-to-app use
- Do not stop EC2 instances — always terminate
- Do not hardcode AWS account IDs, Cloudflare zone IDs, domain names, or credentials anywhere in source
- Do not collapse the two polling phases — EC2 running and Ollama ready are separate concerns
- Do not add Elastic IP — dynamic IP via Cloudflare A record is intentional
- Do not introduce framework dependencies in the widget unless absolutely necessary
- Do not switch Terraform Cloud execution mode back to Remote — the Lambda packaging step requires local access to `api/`, which remote workers do not have
- Do not add new Python dependencies directly into the `local-exec` provisioner command — add them to `api/requirements.txt` instead

