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

        subgraph lambdas["Lambda Functions (Python) — api/"]
            StartFn["start.py\naws_ec2.launch_instance()\ncloudflare.create_record()\nTag: ManagedBy=inference-on-demand"]
            StopFn["stop.py\ncloudflare.delete_record()\naws_ec2.terminate_instance()\nLookup by tag"]
            StatusFn["status.py\naws_ec2.get_state()\naws_ec2.get_ip()\nLookup by tag"]
        end

        subgraph providers["api/providers/"]
            AWSEC2["aws_ec2.py\nboto3\nrun_instances\ndescribe_instances\nterminate_instances\nTag-based lookup"]
        end

        subgraph dnsmod["api/dns/"]
            CFDns["cloudflare.py\nHTTP API\nPOST /dns_records\nDELETE /dns_records/{id}\nGET /dns_records?name="]
        end

        subgraph ec2["EC2 (ephemeral)\nTag: ManagedBy=inference-on-demand"]
            Ollama["Ollama\nHTTP API :11434\nsystemd service"]
            Model["LLM Model\npre-pulled on AMI"]
        end

        SSM["SSM Parameter Store\nAMI ID, instance type\nsubnet ID, security group ID\nCF token, zone ID\nsubdomain, domain\nBasic Auth credentials"]
    end

    CF["Cloudflare DNS\nA record\ninference.yourdomain.com"]

    Developer -->|"Clicks Start / Stop"| Widget
    Widget -->|"POST /start, /stop\nGET /status\nBasic Auth header"| APIGW
    APIGW -->|"Validates Basic Auth"| Authorizer
    Authorizer -->|"Allow / Deny"| APIGW
    APIGW -->|"Route"| StartFn
    APIGW -->|"Route"| StopFn
    APIGW -->|"Route"| StatusFn
    StartFn -->|"Read config + secrets"| SSM
    StopFn -->|"Read CF credentials"| SSM
    StatusFn -->|"Read config"| SSM
    StartFn -->|"launch_instance()"| AWSEC2
    StopFn -->|"terminate_instance()"| AWSEC2
    StatusFn -->|"get_state() / get_ip()"| AWSEC2
    AWSEC2 -->|"run/describe/terminate\ninstances"| ec2
    StartFn -->|"create_record(ip)"| CFDns
    StopFn -->|"delete_record()"| CFDns
    CFDns -->|"POST / DELETE\n/dns_records"| CF
    Widget -->|"Poll :11434 until 200 OK\nfire ollamaReady event"| Ollama
    Developer -->|"Direct inference\ninference.yourdomain.com:11434"| Ollama
    Ollama -->|"Load and serve"| Model
```

## Container Responsibilities

| Container | Technology | Responsibility |
|---|---|---|
| Embeddable widget | Plain JS + Bootstrap | Renders Start/Stop UI, polls status, fires `ollamaReady` / `ollamaOffline` events |
| API Gateway | AWS HTTP API | Routes lifecycle calls, enforces auth via Lambda Authorizer |
| Lambda Authorizer | Python | Validates Basic Auth header against credentials in SSM |
| start.py | Python / Lambda | Reads config from SSM, calls `aws_ec2.launch_instance()`, calls `cloudflare.create_record()` |
| stop.py | Python / Lambda | Reads CF credentials from SSM, calls `cloudflare.delete_record()`, calls `aws_ec2.terminate_instance()` |
| status.py | Python / Lambda | Calls `aws_ec2.get_state()` and `aws_ec2.get_ip()` by tag lookup, returns state to widget |
| aws_ec2.py | Python / boto3 | Implements `ComputeProvider` — wraps `run_instances`, `describe_instances`, `terminate_instances` |
| cloudflare.py | Python / requests | Implements `DNSProvider` — wraps Cloudflare HTTP API for create/delete/lookup |
| SSM Parameter Store | AWS SSM | Stores all config and secrets — read by Lambda at runtime, never written at runtime |
| EC2 instance | Amazon Linux 2023 | Runs Ollama as a systemd service, tagged `ManagedBy=inference-on-demand` |
| Ollama | Ollama runtime | Loads pre-pulled model, exposes HTTP API on :11434 |
| Cloudflare DNS | Cloudflare | Resolves `inference.yourdomain.com` to EC2 public IP (TTL 60s) |

## Notes

- **No runtime state in SSM** — EC2 instances are found by tag `ManagedBy=inference-on-demand`. Cloudflare records are found by querying the subdomain name. Nothing is written to SSM between sessions.
- **Provider abstraction** — `start.py`, `stop.py`, `status.py` call `aws_ec2.py` and `cloudflare.py` through the `ComputeProvider` and `DNSProvider` interfaces. See `architecture/provider-architecture.md` to add other providers.
- **Inference is always direct** — the browser calls Ollama at `inference.yourdomain.com:11434`. Lambda is never in the inference path.
- **Two-stage polling** — widget polls `/status` (EC2 state) then polls Ollama directly on `:11434`. EC2 `running` ≠ Ollama ready (~30–60s gap while model loads).