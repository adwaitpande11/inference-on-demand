# C2 — Container Diagram

```mermaid
graph TD
    Developer["👤 Developer\n(sole user)"]

    subgraph browser["Browser (any web app)"]
        Widget["Embeddable Widget\ninference-widget.js\nPlain JS + Bootstrap"]
    end

    subgraph aws["AWS (ap-south-1)"]
        APIGW["API Gateway\nHTTP API\nRoutes: /start /stop /status"]
        Authorizer["Lambda Authorizer\nPython\nBasic Auth validator"]

        subgraph lambdas["Lambda Functions (Python)"]
            StartFn["start.py\nrun_instances via boto3\nCreate A record via CF API\nWrite state to SSM"]
            StopFn["stop.py\nterminate_instances via boto3\nDelete A record via CF API\nClear state from SSM"]
            StatusFn["status.py\ndescribe_instances via boto3\nReturns EC2 state + public IP"]
        end

        subgraph ec2["EC2 (ephemeral)"]
            Ollama["Ollama\nHTTP API :11434\nsystemd service"]
            Model["LLM Model\npre-pulled on AMI"]
        end

        SSM["SSM Parameter Store\nRuntime config + secrets\nActive instance state"]
    end

    CF["Cloudflare DNS\nA record\nollama.yourdomain.com"]

    Developer -->|"Clicks Start / Stop\nembeds widget via script tag"| Widget
    Widget -->|"POST /start, /stop\nGET /status\nBasic Auth header"| APIGW
    APIGW -->|"Validates Basic Auth"| Authorizer
    Authorizer -->|"Allow / Deny"| APIGW
    APIGW -->|"Route"| StartFn
    APIGW -->|"Route"| StopFn
    APIGW -->|"Route"| StatusFn
    StartFn -->|"Read config\nWrite instance state"| SSM
    StopFn -->|"Read instance state\nClear after stop"| SSM
    StatusFn -->|"Read instance ID"| SSM
    StartFn -->|"run_instances\ndescribe_instances"| ec2
    StopFn -->|"terminate_instances"| ec2
    StatusFn -->|"describe_instances"| ec2
    StartFn -->|"POST create A record"| CF
    StopFn -->|"DELETE A record"| CF
    Widget -->|"Poll :11434 until 200 OK\nfire ollamaReady event"| Ollama
    Developer -->|"Direct inference\nollama.yourdomain.com:11434"| Ollama
    Ollama -->|"Load and serve"| Model
```

## Container responsibilities

| Container | Technology | Responsibility |
|---|---|---|
| Embeddable widget | Plain JS + Bootstrap | Renders Start/Stop button, polls status, fires `ollamaReady` / `ollamaOffline` events |
| API Gateway | AWS HTTP API | Routes lifecycle calls, enforces auth via Lambda Authorizer |
| Lambda Authorizer | Python | Validates Basic Auth header against credentials in SSM |
| start.py | Python / Lambda | Reads config from SSM, calls `run_instances`, creates Cloudflare A record, writes instance state to SSM |
| stop.py | Python / Lambda | Reads instance state from SSM, deletes Cloudflare A record, calls `terminate_instances`, clears SSM state |
| status.py | Python / Lambda | Reads instance ID from SSM, calls `describe_instances`, returns current state and public IP |
| SSM Parameter Store | AWS SSM | Stores all runtime config, secrets, and active instance state (`instance_id`, `dns_record_id`) |
| EC2 instance | Amazon Linux 2023 | Runs Ollama as a systemd service, serves inference on :11434 |
| Ollama | Ollama runtime | Loads pre-pulled model, exposes HTTP API |
| Cloudflare DNS | Cloudflare | Resolves `ollama.yourdomain.com` to EC2 public IP (TTL 60s) |

## Notes

- **No Terraform at runtime** — EC2 and DNS are managed directly by Lambda via boto3 and Cloudflare API. Terraform is only used for persistent infra (`infra/`), applied once.
- **SSM is the runtime state store** — `start.py` writes `instance_id` and `dns_record_id` to SSM; `stop.py` reads and clears them. No external database needed.
- **Inference is always direct** — the browser calls Ollama at `ollama.yourdomain.com:11434`. Lambda is never in the inference path.
- **Two-stage polling** — the widget first polls `/status` (EC2 state via `describe_instances`), then polls Ollama directly on `:11434`. These are separate checks — EC2 running does not mean Ollama is ready.
- **Stop is fast** — terminating an instance and deleting a DNS record via API calls takes ~10-30 seconds, vs 2-3 minutes for a Terraform destroy run.