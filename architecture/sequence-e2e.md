# Sequence Diagram — End-to-End User Interaction & State Transitions

```mermaid
sequenceDiagram
    actor Dev as Developer
    participant Widget as inference-widget.js
    participant API as API Gateway + Lambda
    participant SSM as SSM Parameter Store
    participant EC2 as AWS EC2
    participant CF as Cloudflare DNS
    participant Ollama as Ollama :11434

    Note over Widget: State: UNKNOWN

    Dev->>Widget: Page loads (script tag)
    Widget->>API: GET /status
    API->>SSM: Read active-instance-id
    SSM-->>API: (empty)
    API-->>Widget: { status: "terminated" }

    Note over Widget: State: TERMINATED
    Note over Widget: Renders [▶ Start] button

    Note over Dev,Ollama: ── START FLOW ──

    Dev->>Widget: Clicks Start
    Note over Widget: State: STARTING
    Note over Widget: Renders [Starting...] (disabled)

    Widget->>API: POST /start (Basic Auth)
    API->>SSM: Read config (AMI ID, instance type,\nsubnet, security group,\nCF token, zone ID, subdomain)
    SSM-->>API: Config values
    API->>EC2: run_instances()
    EC2-->>API: { instance_id: "i-xxx" }

    loop Every 5s — EC2 Poller
        Widget->>API: GET /status
        API->>SSM: Read active-instance-id
        API->>EC2: describe_instances(i-xxx)
        EC2-->>API: { state: "pending" }
        API-->>Widget: { status: "pending" }
    end

    EC2-->>API: { state: "running", public_ip: "x.x.x.x" }
    API->>CF: POST /zones/{id}/dns_records\n{ type: A, name: subdomain, content: x.x.x.x, ttl: 60 }
    CF-->>API: { record_id: "cf-yyy" }
    API->>SSM: Write active-instance-id = i-xxx\nWrite active-dns-record-id = cf-yyy
    API-->>Widget: { status: "running", ip: "x.x.x.x" }

    Note over Widget: EC2 running — switch to Ollama poller

    loop Every 5s — Ollama Health Poller
        Widget->>Ollama: GET ollama.yourdomain.com:11434/
        Ollama-->>Widget: Connection refused (still loading)
    end

    Ollama-->>Widget: 200 OK (model loaded, ready)

    Note over Widget: State: READY
    Note over Widget: Renders [■ Stop] button + endpoint URL
    Widget->>Dev: fires window event ollamaReady\n{ endpoint: "http://ollama.yourdomain.com:11434" }

    Note over Dev,Ollama: ── INFERENCE FLOW ──

    Dev->>Ollama: POST /api/generate { stream: false }
    Ollama-->>Dev: 200 OK — complete JSON response
    Dev->>Ollama: POST /api/generate { stream: false }
    Ollama-->>Dev: 200 OK — complete JSON response

    Note over Dev,Ollama: ── STOP FLOW ──

    Dev->>Widget: Clicks Stop
    Note over Widget: State: STOPPING
    Note over Widget: Renders [Stopping...] (disabled)

    Widget->>API: POST /stop (Basic Auth)
    API->>SSM: Read active-instance-id + active-dns-record-id
    SSM-->>API: { instance_id: "i-xxx", dns_record_id: "cf-yyy" }
    API->>CF: DELETE /zones/{id}/dns_records/cf-yyy
    CF-->>API: 200 OK
    API->>EC2: terminate_instances(i-xxx)
    EC2-->>API: { state: "shutting-down" }
    API->>SSM: Clear active-instance-id\nClear active-dns-record-id
    API-->>Widget: { status: "terminated" }

    Note over Widget: State: TERMINATED
    Note over Widget: Renders [▶ Start] button
    Widget->>Dev: fires window event ollamaOffline
```

## Notes

- **Two-stage polling during start:** The widget first polls `GET /status` (EC2 state via `describe_instances`) until EC2 is `running`, then switches to polling Ollama directly on `:11434`. These are separate checks — EC2 `running` does not mean Ollama is ready to serve.
- **Inference is always direct:** The Developer's inference calls go straight to `ollama.yourdomain.com:11434` — Lambda and API Gateway are never in the inference path.
- **DNS propagation gap:** After `start.py` creates the Cloudflare A record, there is a ~60 second TTL window before the subdomain resolves. The Ollama Health Poller handles this naturally — it retries on any failure regardless of the reason.
- **Stop is fast:** Deleting a DNS record and terminating an EC2 instance via direct API calls completes in ~10-30 seconds.
- **SSM as state store:** `start.py` writes `instance_id` and `dns_record_id` to SSM immediately after provisioning. `stop.py` reads these to know what to tear down. `status.py` reads `instance_id` to know whether an active session exists.
- **Page reload resilience:** If the developer reloads the page mid-session, the widget calls `GET /status` on load. `status.py` reads `instance_id` from SSM and calls `describe_instances` — if the instance is running, the widget recovers to STARTING or READY without requiring a new launch.