# Sequence Diagram — End-to-End User Interaction & State Transitions

```mermaid
sequenceDiagram
    actor Dev as Developer
    participant Widget as inference-widget.js
    participant API as API Gateway + Lambda
    participant TFCloud as Terraform Cloud
    participant EC2 as AWS EC2
    participant Ollama as Ollama :11434
    participant CF as Cloudflare DNS

    Note over Widget: State: UNKNOWN

    Dev->>Widget: Page loads (script tag)
    Widget->>API: GET /status
    API-->>Widget: { state: "no_active_run" }

    Note over Widget: State: TERMINATED
    Note over Widget: Renders [▶ Start] button

    Note over Dev,CF: ── START FLOW ──

    Dev->>Widget: Clicks Start
    Note over Widget: State: STARTING
    Note over Widget: Renders [Starting...] (disabled)

    Widget->>API: POST /start (Basic Auth)
    API->>TFCloud: Trigger apply run
    TFCloud-->>API: { run_id: "run-xxx" }
    API-->>Widget: { run_id: "run-xxx" }

    loop Every 5s — Terraform Run Poller
        Widget->>API: GET /status?run_id=run-xxx
        API->>TFCloud: Poll run status
        TFCloud-->>API: { status: "applying" }
        API-->>Widget: { status: "applying" }
    end

    TFCloud->>EC2: Provision EC2 from custom AMI
    EC2-->>TFCloud: Instance running, public_ip = x.x.x.x
    TFCloud->>CF: Create A record → x.x.x.x (TTL 60s)

    Widget->>API: GET /status?run_id=run-xxx
    API->>TFCloud: Poll run status
    TFCloud-->>API: { status: "applied", ip: "x.x.x.x" }
    API-->>Widget: { status: "applied", ip: "x.x.x.x" }

    Note over Widget: EC2 running — switch to Ollama poller

    loop Every 5s — Ollama Health Poller
        Widget->>Ollama: GET ollama.yourdomain.com:11434/
        Ollama-->>Widget: Connection refused (still loading)
    end

    Ollama-->>Widget: 200 OK (model loaded, ready)

    Note over Widget: State: READY
    Note over Widget: Renders [■ Stop] button + endpoint URL
    Widget->>Dev: fires window event ollamaReady\n{ endpoint: "http://ollama.yourdomain.com:11434" }

    Note over Dev,CF: ── INFERENCE FLOW ──

    Dev->>Ollama: POST /api/chat { stream: false }
    Ollama-->>Dev: 200 OK — complete JSON response

    Note over Dev,CF: ── STOP FLOW ──

    Dev->>Widget: Clicks Stop
    Note over Widget: State: STOPPING
    Note over Widget: Renders [Stopping...] (disabled)

    Widget->>API: POST /stop (Basic Auth)
    API->>TFCloud: Trigger destroy run
    TFCloud-->>API: { run_id: "run-yyy" }
    API-->>Widget: { run_id: "run-yyy" }

    loop Every 5s — Terraform Run Poller
        Widget->>API: GET /status?run_id=run-yyy
        API->>TFCloud: Poll run status
        TFCloud-->>API: { status: "destroying" }
        API-->>Widget: { status: "destroying" }
    end

    TFCloud->>EC2: Terminate instance
    TFCloud->>CF: Remove A record

    Widget->>API: GET /status?run_id=run-yyy
    API->>TFCloud: Poll run status
    TFCloud-->>API: { status: "destroyed" }
    API-->>Widget: { status: "destroyed" }

    Note over Widget: State: TERMINATED
    Note over Widget: Renders [▶ Start] button
    Widget->>Dev: fires window event ollamaOffline
```

## Notes

- **Two-stage polling during start:** The widget first polls Terraform Cloud (via `/status`) to wait for EC2 to reach `running`, then switches to polling Ollama directly on `:11434`. These are separate checks — EC2 running does not mean Ollama is ready.
- **Inference is always direct:** The Developer's inference calls go straight to `ollama.yourdomain.com:11434` — Lambda and API Gateway are never in the inference path.
- **DNS propagation gap:** After Terraform creates the Cloudflare A record, there is a ~60 second TTL window before the subdomain resolves. The Ollama Health Poller handles this naturally — it keeps retrying until it gets a 200 OK regardless of the reason for failure.
- **Stop is terminal:** EC2 is terminated (not stopped). The next Start provisions a fresh instance from the AMI with a new public IP. Terraform Cloud updates the Cloudflare A record accordingly.
- **Page reload resilience:** If the developer reloads the page mid-session, the widget calls `GET /status` on load and can recover state from the Terraform Cloud run status.