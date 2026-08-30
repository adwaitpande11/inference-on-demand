from __future__ import annotations

from typing import Any

import requests

from dns.base import DNSProvider


class CloudflareDNSProvider(DNSProvider):
    """Cloudflare DNS implementation of the DNS provider interface."""

    def __init__(self, api_token: str, zone_id: str, base_url: str = "https://api.cloudflare.com/client/v4") -> None:
        self.api_token = api_token
        self.zone_id = zone_id
        self.base_url = base_url.rstrip("/")

    def create_record(self, name: str, ip: str) -> str:
        payload = {
            "type": "A",
            "name": name,
            "content": ip,
            "ttl": 60,
            "proxied": False,
        }

        try:
            response = requests.post(
                f"{self.base_url}/zones/{self.zone_id}/dns_records",
                headers=self._headers(),
                json=payload,
                timeout=10,
            )
            response.raise_for_status()
        except requests.RequestException as exc:
            raise RuntimeError(f"Failed to create Cloudflare DNS record for {name}: {exc}") from exc

        data = response.json()
        record = data.get("result", {})
        record_id = record.get("id")
        if not record_id:
            raise RuntimeError("Cloudflare DNS record creation did not return a record id")

        return record_id

    def delete_record(self, ref: str) -> None:
        record_id = self._resolve_record_id(ref)
        if not record_id:
            return

        try:
            response = requests.delete(
                f"{self.base_url}/zones/{self.zone_id}/dns_records/{record_id}",
                headers=self._headers(),
                timeout=10,
            )
            response.raise_for_status()
        except requests.RequestException as exc:
            raise RuntimeError(f"Failed to delete Cloudflare DNS record {record_id}: {exc}") from exc

    def _resolve_record_id(self, ref: str) -> str | None:
        if not ref:
            return None

        if self._is_record_id(ref):
            return ref

        try:
            response = requests.get(
                f"{self.base_url}/zones/{self.zone_id}/dns_records?name={ref}",
                headers=self._headers(),
                timeout=10,
            )
            response.raise_for_status()
        except requests.RequestException as exc:
            raise RuntimeError(f"Failed to look up Cloudflare DNS record for {ref}: {exc}") from exc

        data = response.json()
        results = data.get("result", [])
        if not results:
            return None

        record = results[0]
        return record.get("id")

    def _headers(self) -> dict[str, str]:
        return {
            "Authorization": f"Bearer {self.api_token}",
            "Content-Type": "application/json",
        }

    @staticmethod
    def _is_record_id(ref: str) -> bool:
        # Cloudflare record IDs are always 32 lowercase hex characters.
        return len(ref) == 32 and all(c in "0123456789abcdef" for c in ref)
