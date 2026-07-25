# Sequence Diagram — End-to-End User Interaction & State Transitions

```mermaid
sequenceDiagram
    actor Dev as Developer
    participant Widget as inference-widget.js
    participant API as API Gateway + Lambda
    participant SSM as SSM Parameter Store
    participant EC2 as AWS EC2 (boto3)
    participant CF as Cloudflare DNS API
    participant Ollama as Ollama :11434

    Note over Widget: State: UNKNOWN

    Dev->>Widget: Page loads (script tag)
    Widget->>API: GET /status
    API->>EC2: describe_instances\nFilter: tag ManagedBy=inference-on-demand\nstate: pending | running
    EC2-->>API: No matching instances
    API-->>Widget: { status: "terminated" }

    Note over Widget: State: TERMINATED
    Note over Widget: Renders [▶ Start] button

    Note over Dev,Ollama: ── START FLOW ──

    Dev->>Widget: Clicks Start
    Note over Widget: State: STARTING
    Note over Widget: Renders [Starting...] (disabled)

    Widget->>API: POST /start (Basic Auth)
    API->>SSM: GetParameters\n(AMI ID, instance type, subnet,\nsecurity group, CF token,\nzone ID, subdomain, domain)
    SSM-->>API: Config + secrets
    API->>EC2: run_instances(\n  ImageId, InstanceType,\n  SubnetId, SecurityGroupIds,\n  Tag: ManagedBy=inference-on-demand\n)
    EC2-->>API: { InstanceId: "i-xxx" }

    loop Every 5s — EC2 Poller
        Widget->>API: GET /status
        API->>EC2: describe_instances\nFilter: tag + state pending|running
        EC2-->>API: { state: "pending" }
        API-->>Widget: { status: "pending" }
    end

    EC2-->>API: { state: "running", PublicIpAddress: "x.x.x.x" }
    API->>CF: POST /zones/{zone_id}/dns_records\n{ type: "A", name: "inference.yourdomain.com",\n  content: "x.x.x.x", ttl: 60 }
    CF-->>API: { id: "cf-yyy" }
    API-->>Widget: { status: "running", ip: "x.x.x.x" }

    Note over Widget: EC2 running — switch to Ollama poller

    loop Every 5s — Ollama Health Poller
        Widget->>Ollama: GET inference.yourdomain.com:11434/
        Ollama-->>Widget: Connection refused (still loading)
    end

    Ollama-->>Widget: 200 OK (model loaded, ready)

    Note over Widget: State: READY
    Note over Widget: Renders [■ Stop] button + endpoint URL
    Widget->>Dev: fires window event ollamaReady\n{ endpoint: "http://inference.yourdomain.com:11434" }

    Note over Dev,Ollama: ── INFERENCE FLOW ──

    Dev->>Ollama: POST /api/generate\n{ model, prompt, stream: false }
    Ollama-->>Dev: 200 OK — complete JSON response

    Note over Dev,Ollama: ── STOP FLOW ──

    Dev->>Widget: Clicks Stop
    Note over Widget: State: STOPPING
    Note over Widget: Renders [Stopping...] (disabled)

    Widget->>API: POST /stop (Basic Auth)
    API->>SSM: GetParameters (CF token, zone ID)
    SSM-->>API: Secrets
    API->>EC2: describe_instances\nFilter: tag ManagedBy=inference-on-demand\nstate: running
    EC2-->>API: { InstanceId: "i-xxx" }
    API->>CF: GET /zones/{zone_id}/dns_records\n?name=inference.yourdomain.com
    CF-->>API: { id: "cf-yyy" }
    API->>CF: DELETE /zones/{zone_id}/dns_records/cf-yyy
    CF-->>API: 200 OK
    API->>EC2: terminate_instances(i-xxx)
    EC2-->>API: { state: "shutting-down" }
    API-->>Widget: { status: "terminated" }

    Note over Widget: State: TERMINATED
    Note over Widget: Renders [▶ Start] button
    Widget->>Dev: fires window event ollamaOffline
```

## Notes

- **Tag-based lookup** — EC2 instances are tagged `ManagedBy=inference-on-demand` at launch. `stop.py` and `status.py` always query by tag — no instance ID stored in SSM.
- **Cloudflare record lookup on stop** — `stop.py` queries Cloudflare by subdomain name to get the record ID — no record ID stored in SSM.
- **Two-stage polling** — EC2 Poller waits for `running` state. Ollama Health Poller then waits for 200 OK directly on `:11434`. ~30–60s gap between the two while the model loads.
- **DNS propagation** — Cloudflare A record is created once EC2 is `running`. TTL 60s. The Ollama Health Poller absorbs the propagation gap naturally.
- **Stop is fast** — `DELETE` on Cloudflare API + `terminate_instances` via boto3 completes in ~10–30 seconds.
- **Inference is direct** — Developer calls `inference.yourdomain.com:11434` directly. Lambda is never in the inference path.
- **Page reload resilience** — Widget calls `GET /status` on load. `status.py` queries EC2 by tag — if an instance is running, widget recovers to STARTING or READY without a new launch.