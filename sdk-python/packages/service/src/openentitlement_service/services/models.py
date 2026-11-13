"""Records the service layer works with: the SDK's frozen Pydantic base, camelCase JSON (ADR-0006)."""
from __future__ import annotations

from datetime import datetime
from enum import StrEnum
from uuid import UUID

from openentitlement.model import OpenEntitlementModel


class ServiceTier(StrEnum):
    """A Workspace's Cloud service tier (GLOSSARY). Cloud Pro allows one Product; Enterprise any number."""

    PRO = "pro"
    ENTERPRISE = "enterprise"


class Workspace(OpenEntitlementModel):
    id: UUID
    name: str
    #: Applies on OpenEntitlement Cloud only; a self-hosted install ignores it (ADR-0008).
    service_tier: ServiceTier = ServiceTier.PRO
    version: int = 1
    created_at: datetime


class Product(OpenEntitlementModel):
    """A commercial offering within a Workspace (ADR-0008).

    ``key`` is the Product's identifier in OEREP paths (RFC-0005) and never changes; ``name`` can.
    An archived Product keeps serving its current customers but cannot be given to a new one.
    """

    id: UUID
    workspace_id: UUID
    key: str
    name: str
    archived_at: datetime | None = None
    version: int = 1
    created_at: datetime


class Account(OpenEntitlementModel):
    """A person signed in through OIDC, identified by their issuer and subject."""

    id: UUID
    issuer: str
    subject: str
    email: str
    platform_admin: bool = False
    created_at: datetime


class Session(OpenEntitlementModel):
    """A console session. Only the hash of its cookie value is stored."""

    token_hash: str
    account_id: UUID
    csrf: str
    expires_at: datetime


class SignInFlow(OpenEntitlementModel):
    """An OIDC authorization request in progress, keyed by the hash of its cookie value."""

    flow_hash: str
    state: str
    nonce: str
    verifier: str
    expires_at: datetime


class ProductRole(StrEnum):
    """A member's Role within one Product (ADR-0008). Owner is Workspace-wide, see ``Member.owner``."""

    MANAGER = "Manager"
    USER = "User"


class Member(OpenEntitlementModel):
    """An Account's membership in a Workspace. An Owner administers the whole Workspace."""

    workspace_id: UUID
    account_id: UUID
    owner: bool = False
    created_at: datetime


class ProductMembership(OpenEntitlementModel):
    """A member's Role in one Product."""

    workspace_id: UUID
    product_id: UUID
    account_id: UUID
    role: ProductRole


class WorkspaceMembership(OpenEntitlementModel):
    """One of an Account's Workspaces, as the Workspace switcher lists it."""

    workspace: Workspace
    owner: bool
    roles: tuple[ProductRole, ...] = ()


class Invitation(OpenEntitlementModel):
    """A single-use link to join a Workspace, bound to the invited email. Only its hash is stored.

    An Owner invitation has no Product; a Manager or User invitation names one.
    """

    id: UUID
    workspace_id: UUID
    token_hash: str
    email: str
    owner: bool = False
    product_id: UUID | None = None
    role: ProductRole | None = None
    invited_by: UUID
    created_at: datetime
    expires_at: datetime


class SettingsChange(OpenEntitlementModel):
    """An authenticated audit fact about members, invitations or the Cloud service tier (ADR-0007).

    ``product_id`` is the Product the change concerns, or ``None`` for a Workspace-wide change
    (Owners, the Cloud service tier). The target's name is recorded as it was at that moment.
    """

    id: UUID
    workspace_id: UUID
    product_id: UUID | None = None
    actor_id: UUID
    actor_email: str
    at: datetime
    action: str
    target_kind: str
    target_id: str
    target_name: str
    before: str | None = None
    after: str | None = None
