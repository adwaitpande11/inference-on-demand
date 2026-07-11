# State Diagram — inference-widget.js

```mermaid
stateDiagram-v2
    [*] --> UNKNOWN : Page loads

    UNKNOWN --> TERMINATED : No active TF run
    UNKNOWN --> READY : Active run + Ollama responding

    TERMINATED --> STARTING : User clicks Start\nPOST /start

    STARTING --> READY : Ollama returns 200 OK
    STARTING --> TERMINATED : Apply failed\nor timeout

    READY --> STOPPING : User clicks Stop\nPOST /stop

    STOPPING --> TERMINATED : Destroy complete
    STOPPING --> READY : Destroy failed\n(rollback)
```

## Notes

- **UNKNOWN** is transient — the widget resolves it immediately on load by calling `GET /status`
- **STARTING** spans two polling phases: Terraform apply → EC2 running, then Ollama health check → 200 OK
- **STOPPING** polls Terraform destroy run until completion
- Error transitions return to the last stable state — apply failure goes back to TERMINATED, destroy failure goes back to READY
