# C1 — System Context

```mermaid
graph TD
    Developer["👤 Developer\n(sole user)"]

    subgraph core["inference-on-demand (core system)"]
        Widget["Embeddable Widget\nStart / Stop button"]
        Lambda["AWS Lambda\nLifecycle API"]
    end

    EC2["AWS EC2\nOllama inference endpoint\ncustom AMI, ephemeral"]
    CF["Cloudflare DNS\nA record → EC2 public IP"]

    Developer -->|"Start / Stop"| Widget
    Widget -->|"HTTP + Basic Auth"| Lambda
    Lambda -->|"boto3\nrun_instances /\nterminate_instances"| EC2
    Lambda -->|"Cloudflare API\nCreate / delete A record"| CF
    Developer -->|"Direct inference calls\ninference.yourdomain.com:11434"| EC2
```

## Notes

- Inference traffic goes directly from the browser to EC2 — Lambda is never in the inference path (avoids 15-min timeout limitation)
- Lambda manages EC2 lifecycle via boto3 and DNS via Cloudflare API directly — no Terraform at runtime
- EC2 is terminated (not stopped) on every session end — every session starts from a clean AMI
- No Elastic IP — Cloudflare A record is created on start with the new public IP and deleted on stop (TTL = 60s)
- Terraform Cloud is used only for persistent infra (`deploy/aws/`) — not involved at runtime