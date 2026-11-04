"""Locks that serialize ``guard`` per (organization, privilege) (spec §5.3)."""

from __future__ import annotations

import threading
from typing import Any, Callable, Protocol, TypeVar

R = TypeVar("R")


def lock_key(organization_id: str, privilege: str) -> str:
    """Requirement 5.2.3: organization and privilege, never subject or resource."""
    return f"oe:{organization_id}:{privilege}"


class Lock(Protocol):
    domain: str

    def run(self, key: str, fn: Callable[[Any], R]) -> R:
        """Run ``fn(tx)`` holding exclusive ownership of ``key``. ``tx`` is lock-specific (or None)."""
        ...


class InProcessLock:
    """Serializes within ONE process only (Requirement 5.3.2).

    Multi-instance deployments must use a shared lock, e.g. ``PostgresAdvisoryLock``.
    """

    domain = "process"

    def __init__(self) -> None:
        self._guard = threading.Lock()
        self._locks: dict[str, tuple[threading.Lock, int]] = {}

    def run(self, key: str, fn: Callable[[Any], R]) -> R:
        with self._guard:
            lk, users = self._locks.get(key, (threading.Lock(), 0))
            self._locks[key] = (lk, users + 1)
        try:
            with lk:
                return fn(None)
        finally:
            with self._guard:
                lk, users = self._locks[key]
                if users <= 1:
                    del self._locks[key]
                else:
                    self._locks[key] = (lk, users - 1)
