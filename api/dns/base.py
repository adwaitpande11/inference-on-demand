from __future__ import annotations

from abc import ABC, abstractmethod


class DNSProvider(ABC):
    """Abstract interface for DNS providers."""

    @abstractmethod
    def create_record(self, name: str, ip: str) -> str:
        """Create a DNS record and return a reference for later deletion."""

    @abstractmethod
    def delete_record(self, ref: str) -> None:
        """Delete the DNS record identified by the reference."""
