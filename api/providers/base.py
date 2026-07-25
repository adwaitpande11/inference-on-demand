from __future__ import annotations

from abc import ABC, abstractmethod


class ComputeProvider(ABC):
    """Abstract interface for compute providers."""

    @abstractmethod
    def launch_instance(self, config: dict) -> str:
        """Launch a compute instance and return a handle."""

    @abstractmethod
    def terminate_instance(self, handle: str) -> None:
        """Terminate the instance identified by the handle."""

    @abstractmethod
    def get_state(self, handle: str) -> str:
        """Return the current state of the instance identified by the handle."""

    @abstractmethod
    def get_ip(self, handle: str) -> str:
        """Return the public IP address of the instance identified by the handle."""
