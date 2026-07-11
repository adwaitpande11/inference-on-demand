# C1 — System Context

```mermaid
graph TD
    Developer["👤 Developer\n(sole user)"]

    subgraph core["inference-on-demand (core system)"]
        Widget["Embeddable Widget\nStart / Stop button"]
        Lambda["AWS Lambda\nLifecycle API"]
    end

    TFCloud["Terraform Cloud\nState + apply / destroy"]
    EC2["AWS EC2\nOllama inference endpoint\ncustom AMI, ephemeral"]
    CF["Cloudflare DNS\nA record → EC2 public IP"]

    Developer -->|"Start / Stop"| Widget
    Widget -->|"HTTP + Basic Auth"| Lambda
    Lambda -->|"Trigger apply / destroy"| TFCloud
    TFCloud -->|"Provision EC2 instance"| EC2
    TFCloud -->|"Create / remove A record\nusing EC2 public IP output"| CF
    Developer -->|"Direct inference calls\nollama.yourdomain.com:11434"| EC2
```

## Notes

- Inference traffic goes directly from the browser to EC2 — Lambda is not in the inference path (avoids 15-min timeout limitation)
- Cloudflare DNS is managed entirely by Terraform Cloud using `aws_instance.ollama.public_ip` as input — EC2 has no direct relationship with Cloudflare
- EC2 is terminated (not stopped) on destroy — every session starts from a clean AMI
- No Elastic IP — the A record is recreated on every `terraform apply` with the new public IP (TTL = 60s)
