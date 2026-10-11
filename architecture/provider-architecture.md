# Provider Architecture

This diagram shows the abstraction layers that make `inference-on-demand` portable across cloud providers and compute types.

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

    subgraph deploy["Deployment Layer (deploy/)"]
        DeployAWS["aws/\nTerraform\nAWS Lambda, API Gateway\nIAM, Security Group"]
        DeployAzure["azure/\nTerraform or Bicep\n(future)"]
        DeployGCP["gcp/\nTerraform\n(future)"]
    end

    Start -->|"uses"| ComputeBase
    Stop -->|"uses"| ComputeBase
    Status -->|"uses"| ComputeBase

    ComputeBase -->|"implemented by"| AWSEC2
    ComputeBase -->|"implemented by"| AWSECS
    ComputeBase -->|"implemented by"| GCPCompute
    ComputeBase -->|"implemented by"| AzureVM

    DeployAWS -->|"provisions runtime for"| AWSEC2
    DeployAzure -->|"provisions runtime for"| AzureVM
    DeployGCP -->|"provisions runtime for"| GCPCompute
```

## How to Add a New Compute Provider

1. Create `api/providers/<your_provider>.py`
2. Extend `ComputeProvider` from `api/providers/base.py`
3. Implement all four methods: `launch_instance`, `terminate_instance`, `get_state`, `get_ip`
4. Register your provider in `_build_compute_provider` in the orchestration handlers
5. Create `deploy/<your_cloud>/` with the corresponding IaC configuration
6. Add `architecture/<your_cloud>/` with provider-specific diagrams

## Design Principles

- Orchestration layer (`start.py`, `stop.py`, `status.py`) never contains provider-specific code
- Provider selection is config-driven — change the compute provider in your config store, no code changes needed
- Each provider is a single self-contained file with no cross-provider dependencies