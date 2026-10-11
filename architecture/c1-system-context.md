# C1 — System Context

```mermaid
graph TD
    Developer["👤 Developer\n(sole user)"]

    subgraph core["inference-on-demand (core system)"]
        Widget["Embeddable Widget\nStart / Stop button"]
        Lambda["AWS Lambda\nLifecycle API"]
    end

    EC2["AWS EC2\nOllama inference endpoint\ncustom AMI, ephemeral"]

    Developer -->|"Start / Stop"| Widget
    Widget -->|"HTTP + Basic Auth"| Lambda
    Lambda -->|"boto3\nrun_instances /\nterminate_instances"| EC2
    Developer -->|"Direct inference calls\nhttp://<ec2-public-ip>:11434"| EC2
```

## Notes

- Inference traffic goes directly from the client to the EC2 instance's public IP on port 11434 — Lambda is never in the inference path (avoiding API Gateway and Lambda execution timeout limits).
- Lambda manages the EC2 lifecycle via boto3 — no Terraform is invoked at runtime.
- EC2 is terminated (not stopped) on every session end — every session starts from a clean AMI.
- Terraform is used only for persistent infrastructure (`deploy/aws/`) — not involved at runtime.