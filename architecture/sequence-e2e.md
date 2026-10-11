# Sequence Diagram — End-to-End User Interaction & State Transitions

```mermaid
sequenceDiagram
    actor Dev as Developer
    participant Widget as inference-widget.js
    participant API as API Gateway + Lambda
    participant SSM as SSM Parameter Store
    participant EC2 as AWS EC2 (boto3)
    participant Ollama as Ollama :11434

    Note over Widget: State: UNKNOWN

    Dev->>Widget: Page loads (script tag)
    Widget->>API: GET /status
    API->>EC2: describe_instances\nFilter: tag ManagedBy=inference-on-demand\nstate: pending | running
    EC2-->>API: No matching instances
    API-->>Widget: { state: "terminated", ip: "" }

    Note over Widget: State: TERMINATED
    Note over Widget: Renders [▶ Start] button

    Note over Dev,Ollama: ── START FLOW ──

    Dev->>Widget: Clicks Start
    Note over Widget: State: STARTING
    Note over Widget: Renders [Starting...] (disabled)

    Widget->>API: POST /start (Basic Auth)
    API->>SSM: GetParameters\n(AMI ID, instance type, subnet,\nsecurity group, compute provider)
    SSM-->>API: Config values
    API->>EC2: run_instances(\n  ImageId, InstanceType,\n  NetworkInterfaces: [{SubnetId, SecurityGroupIds, AssociatePublicIpAddress: true}],\n  Tag: ManagedBy=inference-on-demand\n)
    EC2-->>API: { InstanceId: "i-xxx" }
    API-->>Widget: { instance_id: "i-xxx" }

    loop Every 5s — EC2 Poller
        Widget->>API: GET /status
        API->>EC2: describe_instances\nFilter: tag + state pending|running
        EC2-->>API: { state: "pending", PublicIpAddress: "" }
        API-->>Widget: { state: "pending", ip: "" }
    end

    EC2-->>API: { state: "running", PublicIpAddress: "x.x.x.x" }
    API-->>Widget: { state: "running", ip: "x.x.x.x" }

    Note over Widget: EC2 running — switch to Ollama poller

    loop Every 5s — Ollama Health Poller
        Widget->>Ollama: GET http://x.x.x.x:11434/
        Ollama-->>Widget: Connection refused (model still loading)
    end

    Ollama-->>Widget: 200 OK (model loaded, ready)

    Note over Widget: State: READY
    Note over Widget: Renders [■ Stop] button + endpoint URL
    Widget->>Dev: fires window event ollamaReady\n{ endpoint: "http://x.x.x.x:11434", ip: "x.x.x.x" }

    Note over Dev,Ollama: ── INFERENCE FLOW ──

    Dev->>Ollama: POST http://x.x.x.x:11434/api/generate\n{ model, prompt, stream: false }
    Ollama-->>Dev: 200 OK — complete JSON response

    Note over Dev,Ollama: ── STOP FLOW ──

    Dev->>Widget: Clicks Stop
    Note over Widget: State: STOPPING
    Note over Widget: Renders [Stopping...] (disabled)

    Widget->>API: POST /stop (Basic Auth)
    API->>EC2: describe_instances\nFilter: tag ManagedBy=inference-on-demand\nstate: running
    EC2-->>API: { InstanceId: "i-xxx" }
    API->>EC2: terminate_instances(i-xxx)
    EC2-->>API: { state: "shutting-down" }
    API-->>Widget: { stopped: true }

    loop Every 5s — Termination Poller
        Widget->>API: GET /status
        API->>EC2: describe_instances\nFilter: tag + state
        EC2-->>API: { state: "terminated" }
        API-->>Widget: { state: "terminated", ip: "" }
    end

    Note over Widget: State: TERMINATED
    Note over Widget: Renders [▶ Start] button
    Widget->>Dev: fires window event ollamaOffline
```

## Notes

- **Tag-based lookup** — EC2 instances are tagged `ManagedBy=inference-on-demand` at launch. `stop.py` and `status.py` always query by tag — no instance ID stored in SSM.
- **Two-stage polling** — EC2 Poller waits for `running` state with an allocated public IP. Ollama Health Poller then waits for 200 OK directly on `:11434`. ~30–60s gap between the two while the model loads.
- **Fast Stop** — `terminate_instances` via boto3 initiates immediate instance shutdown.
- **Inference is direct** — Developer calls `http://<ec2-public-ip>:11434` directly. Lambda is never in the inference path.
- **Page reload resilience** — Widget calls `GET /status` on load. `status.py` queries EC2 by tag — if an instance is running, widget recovers to STARTING or READY without a new launch.