from __future__ import annotations

import json
from typing import Any

try:
    import boto3
except ImportError:  # pragma: no cover - exercised in environments without boto3
    boto3 = None  # type: ignore[assignment]

from api.providers.aws_ec2 import AWSEC2Provider
from api.providers.base import ComputeProvider


if boto3 is None:
    ssm_client = None
else:
    ssm_client = boto3.client("ssm")


def handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    config = _load_config()
    compute_provider = _build_compute_provider(config)

    state = compute_provider.get_state("")
    ip = compute_provider.get_ip("")

    return {
        "statusCode": 200,
        "body": json.dumps({"state": state, "ip": ip}),
    }


def _load_config() -> dict[str, str]:
    return {
        "compute_provider": _get_parameter("/inference-on-demand/compute-provider"),
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
