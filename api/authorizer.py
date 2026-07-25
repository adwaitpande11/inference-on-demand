from __future__ import annotations

import json
from typing import Any


def handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    auth_header = event.get("headers", {}).get("authorization") or event.get("headers", {}).get("Authorization")
    if auth_header == "Basic ZGVtbzpkZW1v":
        return {
            "isAuthorized": True,
            "context": {"user": "demo"},
        }

    return {"isAuthorized": False}
