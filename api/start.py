from __future__ import annotations

import json
from typing import Any

try:
    import boto3
except ImportError:  # pragma: no cover - exercised in environments without boto3
    boto3 = None  # type: ignore[assignment]

from dns.base import DNSProvider
from dns.cloudflare import CloudflareDNSProvider
from providers.aws_ec2 import AWSEC2Provider
from providers.base import ComputeProvider


if boto3 is None:
    ssm_client = None
else:
    ssm_client = boto3.client("ssm")


def handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    config = _load_config()
    compute_provider = _build_compute_provider(config)
    dns_provider = _build_dns_provider(config)

    handle = compute_provider.launch_instance(config)
    ip = compute_provider.get_ip(handle)
    if not ip:
        raise RuntimeError("EC2 instance did not return a public IP")

    record_ref = dns_provider.create_record(config["cf_subdomain"], ip)

    return {
        "statusCode": 200,
        "body": json.dumps({"instance_id": handle, "record_ref": record_ref}),
    }


def _load_config() -> dict[str, str]:
    return {
        "ami_id": _get_parameter("/inference-on-demand/ami-id"),
        "instance_type": _get_parameter("/inference-on-demand/instance-type"),
        "subnet_id": _get_parameter("/inference-on-demand/subnet-id"),
        "security_group_id": _get_parameter("/inference-on-demand/security-group-id"),
        "compute_provider": _get_parameter("/inference-on-demand/compute-provider"),
        "dns_provider": _get_parameter("/inference-on-demand/dns-provider"),
        "cf_token": _get_parameter("/inference-on-demand/cf-token"),
        "cf_zone_id": _get_parameter("/inference-on-demand/cf-zone-id"),
        "cf_subdomain": _get_parameter("/inference-on-demand/cf-subdomain"),
        "cf_domain": _get_parameter("/inference-on-demand/cf-domain"),
    }


def _get_parameter(name: str) -> str:
    if ssm_client is None:
        raise RuntimeError("boto3 is required to read SSM parameters")
    response = ssm_client.get_parameter(Name=name, WithDecryption=True)
    return response["Parameter"]["Value"]


def _build_compute_provider(config: dict[str, str]) -> ComputeProvider:
    provider_name = config.get("compute_provider", "aws_ec2")
    if provider_name != "aws_ec2":
        raise RuntimeError(f"Unsupported compute provider: {provider_name}")
    return AWSEC2Provider()


def _build_dns_provider(config: dict[str, str]) -> DNSProvider:
    provider_name = config.get("dns_provider", "cloudflare")
    if provider_name != "cloudflare":
        raise RuntimeError(f"Unsupported DNS provider: {provider_name}")
    return CloudflareDNSProvider(api_token=config["cf_token"], zone_id=config["cf_zone_id"])
