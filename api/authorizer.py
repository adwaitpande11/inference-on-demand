from __future__ import annotations

import base64
from typing import Any

try:
    import boto3
except ImportError:  # pragma: no cover - exercised in environments without boto3
    boto3 = None  # type: ignore[assignment]


if boto3 is None:
    ssm_client = None
else:
    ssm_client = boto3.client("ssm")


def handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    auth_header = event.get("headers", {}).get("authorization") or event.get("headers", {}).get("Authorization")
    if not auth_header:
        return {"isAuthorized": False}

    username = _get_parameter("/inference-on-demand/basic-auth-user")
    password = _get_parameter("/inference-on-demand/basic-auth-password")
    expected_header = f"Basic {base64.b64encode(f'{username}:{password}'.encode()).decode()}"

    if auth_header == expected_header:
        return {"isAuthorized": True}

    return {"isAuthorized": False}


def _get_parameter(name: str) -> str:
    if ssm_client is None:
        raise RuntimeError("boto3 is required to read SSM parameters")
    response = ssm_client.get_parameter(Name=name, WithDecryption=True)
    return response["Parameter"]["Value"]
