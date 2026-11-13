"""Who may do what in a Workspace: Roles per Product, Owners and Platform administrators (ADR-0008).

Every operation asks the ``Actor`` before it reads or changes anything. A Product the Actor has no
Role in is invisible: it is reported as not found, never as forbidden, so its existence is not
revealed. A visible Product the Role cannot change is ``permission-denied``.
"""
from __future__ import annotations

from collections.abc import Iterable, Mapping
from dataclasses import dataclass, field
from enum import StrEnum
from uuid import UUID

from .models import Account, ProductRole
from .problems import NotFound, PermissionDenied

OWNER = "Owner"
PLATFORM_ADMINISTRATOR = "Platform administrator"
#: A member whose Product Roles were all removed. They see the Workspace but none of its Products.
MEMBER = "Member"


class Permission(StrEnum):
    """Authority to perform an administrative action (GLOSSARY: Permission)."""

    #: Read a Product: its Catalog, Tiers and the Organizations' terms in it.
    READ_PRODUCT = "product:read"
    #: Change a Product's Catalog, Tiers, Organization terms and API keys (later tickets).
    EDIT_PRODUCT = "product:edit"
    #: Create, rename, archive, restore and delete Products.
    MANAGE_PRODUCTS = "products:manage"
    #: Add or rename a Workspace-wide Organization: any Product's Manager (ADR-0008).
    MANAGE_ORGANIZATIONS = "organizations:manage"
    #: Invite a Product's Managers and Users, change their Roles in it and remove them.
    MANAGE_MEMBERS = "members:manage"
    #: Make members Owners, change or remove Owners, and invite Owners.
    MANAGE_OWNERS = "owners:manage"
    #: Change the Workspace's Cloud service tier. Platform administrators only.
    SET_SERVICE_TIER = "service-tier:set"
    #: Read the Audit log: Owners in full, a Product's Managers for the Products they manage (ADR-0007).
    READ_AUDIT_LOG = "audit-log:read"


#: What each Product Role allows within its Product.
PRODUCT_ROLE_PERMISSIONS: Mapping[ProductRole, frozenset[Permission]] = {
    ProductRole.USER: frozenset({Permission.READ_PRODUCT}),
    ProductRole.MANAGER: frozenset({Permission.READ_PRODUCT, Permission.EDIT_PRODUCT, Permission.MANAGE_MEMBERS}),
}

#: Permissions only a Platform administrator has, even over a Workspace's Owners.
PLATFORM_PERMISSIONS = frozenset({Permission.SET_SERVICE_TIER})

_DENIED = {
    Permission.READ_PRODUCT: "Your Role does not allow reading this Product.",
    Permission.EDIT_PRODUCT: "Only this Product's Managers and the Workspace's Owners can change it.",
    Permission.MANAGE_PRODUCTS: "Only the Workspace's Owners can create, rename, archive, restore or delete Products.",
    Permission.MANAGE_ORGANIZATIONS: "Only a Product's Managers and the Workspace's Owners can add or rename Organizations.",
    Permission.MANAGE_MEMBERS: "Only this Product's Managers and the Workspace's Owners can manage its members.",
    Permission.MANAGE_OWNERS: "Only the Workspace's Owners can invite, appoint, change or remove Owners.",
    Permission.SET_SERVICE_TIER: "Only a Platform administrator can change the Cloud service tier.",
    Permission.READ_AUDIT_LOG: "Only the Workspace's Owners and its Products' Managers can read the Audit log.",
}


@dataclass(frozen=True)
class Actor:
    """An Account acting in one Workspace, with its Roles there."""

    account: Account
    workspace_id: UUID
    owner: bool = False
    roles: Mapping[UUID, ProductRole] = field(default_factory=dict)

    @property
    def administers_workspace(self) -> bool:
        """Owners and Platform administrators administer every Product of the Workspace."""
        return self.owner or self.account.platform_admin

    @property
    def role(self) -> str:
        """The Role shown for the whole Workspace: the highest one the Actor has."""
        if self.owner:
            return OWNER
        if self.account.platform_admin:
            return PLATFORM_ADMINISTRATOR
        return highest(self.roles.values())

    def role_in(self, product_id: UUID) -> str | None:
        if self.administers_workspace:
            return self.role
        role = self.roles.get(product_id)
        return role.value if role else None

    def sees(self, product_id: UUID) -> bool:
        return self.role_in(product_id) is not None

    def can(self, permission: Permission, product_id: UUID | None = None) -> bool:
        if permission in PLATFORM_PERMISSIONS:
            return self.account.platform_admin
        if self.administers_workspace:
            return True
        if permission in (Permission.MANAGE_ORGANIZATIONS, Permission.READ_AUDIT_LOG):
            # Organizations and the Audit log are Workspace-wide: a Manager of any Product may add one or read it.
            return ProductRole.MANAGER in self.roles.values()
        if product_id is None:
            return False
        role = self.roles.get(product_id)
        return role is not None and permission in PRODUCT_ROLE_PERMISSIONS[role]

    def products_with(self, permission: Permission, product_ids: Iterable[UUID]) -> set[UUID]:
        """Those of ``product_ids`` where the Actor has ``permission``."""
        return {p for p in product_ids if self.can(permission, p)}

    def require(self, permission: Permission, product_id: UUID | None = None) -> None:
        """Refuse unless the Actor has ``permission``, for ``product_id`` when the action concerns one Product.

        A Product the Actor cannot see is ``not-found``, so a refusal never reveals that it exists.
        """
        if product_id is not None and not self.sees(product_id):
            raise NotFound("This Product does not exist or you have no Role in it.")
        if not self.can(permission, product_id):
            raise PermissionDenied(_DENIED[permission], permission=permission.value)


def highest(roles: Iterable[ProductRole]) -> str:
    """The highest of Product Roles: Manager over User, and ``Member`` when there are none."""
    found = set(roles)
    if ProductRole.MANAGER in found:
        return ProductRole.MANAGER.value
    if ProductRole.USER in found:
        return ProductRole.USER.value
    return MEMBER
