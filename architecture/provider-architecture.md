# Provider Architecture

This diagram shows the abstraction layers that make `inference-on-demand` portable across cloud providers, compute types, and DNS services.

```mermaid
graph TD
    subgraph orchestration["Orchestration Layer (api/)"]
        Start["start.py"]
        Stop["stop.py"]
        Status["status.py"]
    end

    subgraph compute["Compute Abstraction (api/providers/)"]
        ComputeBase["base.py\nAbstract ComputeProvider\n\nlaunch_instance(config) → handle\nterminate_instance(handle)\nget_state(handle) → state\nget_ip(handle) → ip"]

        AWSEC2["aws_ec2.py\nAWS EC2\nboto3 run_instances"]
        AWSECS["aws_ecs.py\nAWS ECS Fargate\nboto3 run_task\n(future)"]
        GCPCompute["gcp_compute.py\nGCP Compute Engine\n(future)"]
        AzureVM["azure_vm.py\nAzure Virtual Machine\n(future)"]
    end

    subgraph dns["DNS Abstraction (api/dns/)"]
        DNSBase["base.py\nAbstract DNSProvider\n\ncreate_record(name, ip) → ref\ndelete_record(ref)"]

        Cloudflare["cloudflare.py\nCloudflare DNS\nHTTP API"]
        Route53["route53.py\nAWS Route 53\nboto3\n(future)"]
        AzureDNS["azure_dns.py\nAzure DNS\n(future)"]
    end

    subgraph deploy["Deployment Layer (deploy/)"]
        DeployAWS["aws/\nTerraform\nAWS Lambda, API Gateway\nIAM, Security Group"]
        DeployAzure["azure/\nTerraform or Bicep\n(future)"]
        DeployGCP["gcp/\nTerraform\n(future)"]
    end

    Start -->|"uses"| ComputeBase
    Start -->|"uses"| DNSBase
    Stop -->|"uses"| ComputeBase
    Stop -->|"uses"| DNSBase
    Status -->|"uses"| ComputeBase

    ComputeBase -->|"implemented by"| AWSEC2
    ComputeBase -->|"implemented by"| AWSECS
    ComputeBase -->|"implemented by"| GCPCompute
    ComputeBase -->|"implemented by"| AzureVM

    DNSBase -->|"implemented by"| Cloudflare
    DNSBase -->|"implemented by"| Route53
    DNSBase -->|"implemented by"| AzureDNS

    DeployAWS -->|"provisions runtime for"| AWSEC2
    DeployAzure -->|"provisions runtime for"| AzureVM
    DeployGCP -->|"provisions runtime for"| GCPCompute
```

## How to Add a New Compute Provider

1. Create `api/providers/<your_provider>.py`
2. Extend `ComputeProvider` from `api/providers/base.py`
3. Implement all four methods: `launch_instance`, `terminate_instance`, `get_state`, `get_ip`
4. Add your provider to the factory in `api/providers/__init__.py`
5. Create `deploy/<your_cloud>/` with the corresponding IaC config
6. Add `architecture/<your_cloud>/` with your provider-specific diagrams

## How to Add a New DNS Provider

1. Create `api/dns/<your_provider>.py`
2. Extend `DNSProvider` from `api/dns/base.py`
3. Implement both methods: `create_record`, `delete_record`
4. Add your provider to the factory in `api/dns/__init__.py`

## Design Principles

- Orchestration layer (`start.py`, `stop.py`, `status.py`) never contains provider-specific code
- Provider selection is config-driven — change the provider in your config store, no code changes needed
- Compute and DNS providers are independently swappable — any combination works
- Each provider is a single self-contained file with no cross-provider dependencies