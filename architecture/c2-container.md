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
            StartFn["start.py\nTriggers terraform apply\nvia TF Cloud API"]
            StopFn["stop.py\nTriggers terraform destroy\nvia TF Cloud API"]
            StatusFn["status.py\nPolls TF Cloud run state"]
        end

        subgraph ec2["EC2 — c5.2xlarge (ephemeral)"]
            Ollama["Ollama\nHTTP API :11434\nsystemd service"]
            Model["LLM Model\npre-pulled on AMI"]
        end

        SSM["SSM Parameter Store\nAMI ID, instance type\nsecurity group ID"]
    end

    subgraph tfcloud["Terraform Cloud"]
        Workspace["Workspace\nRemote state\napply / destroy runs"]
    end

    CF["Cloudflare DNS\nA record\nollama.yourdomain.com"]

    Developer -->|"Clicks Start / Stop\nembeds widget via script tag"| Widget
    Widget -->|"POST /start, /stop\nGET /status\nBasic Auth header"| APIGW
    APIGW -->|"Validates Basic Auth"| Authorizer
    Authorizer -->|"Allow / Deny"| APIGW
    APIGW -->|"Route"| StartFn
    APIGW -->|"Route"| StopFn
    APIGW -->|"Route"| StatusFn
    StartFn -->|"Read config"| SSM
    StartFn -->|"Trigger apply run"| Workspace
    StopFn -->|"Trigger destroy run"| Workspace
    StatusFn -->|"Poll run status"| Workspace
    Workspace -->|"Provision EC2\nfrom custom AMI"| ec2
    Workspace -->|"Create A record\nusing EC2 public IP output"| CF
    Widget -->|"Poll :11434 until 200 OK\nfire ollamaReady event"| Ollama
    Developer -->|"Direct inference\nollama.yourdomain.com:11434"| Ollama
    Ollama -->|"Load and serve"| Model
```

## Container responsibilities

| Container | Technology | Responsibility |
|---|---|---|
| Embeddable widget | Plain JS + Bootstrap | Renders Start/Stop button, polls status, fires `ollamaReady` event |
| API Gateway | AWS HTTP API | Routes lifecycle calls, enforces auth via Lambda Authorizer |
| Lambda Authorizer | Python | Validates Basic Auth header against credentials in environment |
| start.py | Python / Lambda | Reads config from SSM, triggers `terraform apply` via TF Cloud API |
| stop.py | Python / Lambda | Triggers `terraform destroy` via TF Cloud API |
| status.py | Python / Lambda | Polls Terraform Cloud run status, returns state to widget |
| SSM Parameter Store | AWS SSM | Stores AMI ID, instance type, security group ID — read by Lambda at runtime |
| Terraform Cloud workspace | Terraform | Holds remote state, executes apply/destroy, provisions EC2 + Cloudflare record |
| EC2 instance | Amazon Linux 2023 | Runs Ollama as a systemd service, serves inference on :11434 |
| Ollama | Ollama runtime | Loads pre-pulled model, exposes OpenAI-compatible HTTP API |
| Cloudflare DNS | Cloudflare | Resolves `ollama.yourdomain.com` to EC2 public IP (TTL 60s) |

## Notes

- API Gateway and all Lambda functions are **persistent** — provisioned once via `terraform apply` in `infra/`
- EC2 and the Cloudflare A record are **ephemeral** — created and destroyed per session by the Terraform Cloud workspace
- The widget polls Ollama directly on `:11434` to detect readiness — Lambda is not in the health-check path
- SSM Parameter Store decouples AMI ID from Lambda code — update the AMI without redeploying Lambda
- Security Group restricts port 11434 to the developer's IP only — Ollama has no application-level auth
