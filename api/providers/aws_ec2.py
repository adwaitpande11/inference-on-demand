from __future__ import annotations

import types
from typing import Any

try:
    import boto3
    from botocore.exceptions import BotoCoreError, ClientError
except ImportError:  # pragma: no cover - exercised in environments without boto3
    class _Boto3Stub(types.SimpleNamespace):
        def client(self, *args: Any, **kwargs: Any) -> Any:
            raise RuntimeError("boto3 is required to use the AWS EC2 provider")

    boto3 = _Boto3Stub()
    BotoCoreError = ClientError = Exception  # type: ignore[assignment]

from api.providers.base import ComputeProvider


class AWSEC2Provider(ComputeProvider):
    """AWS EC2 implementation of the compute provider interface."""

    def __init__(self, region_name: str = "ap-south-1") -> None:
        self.region_name = region_name
        self._client: Any | None = None

    @property
    def client(self) -> Any:
        if self._client is None:
            self._client = boto3.client("ec2", region_name=self.region_name)
        return self._client

    def launch_instance(self, config: dict[str, Any]) -> str:
        try:
            response = self.client.run_instances(
                ImageId=config["ami_id"],
                InstanceType=config["instance_type"],
                SubnetId=config["subnet_id"],
                SecurityGroupIds=[config["security_group_id"]],
                TagSpecifications=[
                    {
                        "ResourceType": "instance",
                        "Tags": [{"Key": "ManagedBy", "Value": "inference-on-demand"}],
                    }
                ],
            )
        except (BotoCoreError, ClientError) as exc:
            raise RuntimeError(f"Failed to launch EC2 instance: {exc}") from exc

        instances = response.get("Instances", [])
        if not instances:
            raise RuntimeError("EC2 launch completed without returning an instance")

        instance_id = instances[0].get("InstanceId")
        if not instance_id:
            raise RuntimeError("EC2 launch returned an instance without an InstanceId")

        return instance_id

    def terminate_instance(self, handle: str) -> None:
        instance_id = self._get_instance_id_by_tag(handle)
        if not instance_id:
            return

        try:
            self.client.terminate_instances(InstanceIds=[instance_id])
        except (BotoCoreError, ClientError) as exc:
            raise RuntimeError(f"Failed to terminate EC2 instance {instance_id}: {exc}") from exc

    def get_state(self, handle: str) -> str:
        instance_id = self._get_instance_id_by_tag(handle)
        if not instance_id:
            return "terminated"

        try:
            response = self.client.describe_instances(InstanceIds=[instance_id])
        except (BotoCoreError, ClientError) as exc:
            raise RuntimeError(f"Failed to describe EC2 instance {instance_id}: {exc}") from exc

        reservations = response.get("Reservations", [])
        if not reservations:
            return "terminated"

        instances = reservations[0].get("Instances", [])
        if not instances:
            return "terminated"

        state_name = instances[0].get("State", {}).get("Name", "terminated")
        return state_name.lower()

    def get_ip(self, handle: str) -> str:
        instance_id = self._get_instance_id_by_tag(handle)
        if not instance_id:
            return ""

        try:
            response = self.client.describe_instances(InstanceIds=[instance_id])
        except (BotoCoreError, ClientError) as exc:
            raise RuntimeError(f"Failed to describe EC2 instance {instance_id}: {exc}") from exc

        reservations = response.get("Reservations", [])
        if not reservations:
            return ""

        instances = reservations[0].get("Instances", [])
        if not instances:
            return ""

        instance = instances[0]
        public_ip = instance.get("PublicIpAddress") or instance.get("PrivateIpAddress", "")
        return public_ip or ""

    def _get_instance_id_by_tag(self, handle: str) -> str | None:
        try:
            response = self.client.describe_instances(
                Filters=[
                    {"Name": "tag:ManagedBy", "Values": ["inference-on-demand"]},
                    {"Name": "instance-state-name", "Values": ["pending", "running", "stopping", "stopped"]},
                ]
            )
        except (BotoCoreError, ClientError) as exc:
            raise RuntimeError(f"Failed to find EC2 instance by tag: {exc}") from exc

        reservations = response.get("Reservations", [])
        for reservation in reservations:
            for instance in reservation.get("Instances", []):
                tags = instance.get("Tags", [])
                if any(tag.get("Key") == "ManagedBy" and tag.get("Value") == "inference-on-demand" for tag in tags):
                    return instance.get("InstanceId")

        return None
