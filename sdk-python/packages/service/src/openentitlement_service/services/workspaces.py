"""Workspaces and their Products (ADR-0008).

A Workspace starts with one Product, and its creator is its Owner. Members see only the Products
where they have a Role; Owners and Platform administrators see all of them. Only Owners (and
Platform administrators) create, rename, archive, restore and delete Products. A Product's ID and
key never change.

On OpenEntitlement Cloud, a Workspace's Cloud service tier limits its Products: Cloud Pro allows one,
Enterprise any number. Only a Platform administrator changes the tier, and a downgrade is refused
while the Workspace has more than one Product. A self-hosted install has no limit.
"""
from __future__ import annotations

import re
import unicodedata
from collections.abc import AsyncIterator, Callable, Sequence
from contextlib import asynccontextmanager
from dataclasses import dataclass
from datetime import UTC, datetime
from enum import StrEnum
from typing import Any
from uuid import UUID, uuid4

from pydantic import JsonValue

from openentitlement.model import OpenEntitlementModel

from . import audit
from .access import PLATFORM_ADMINISTRATOR, Actor, Permission, highest, OWNER
from .audit import Aspect, AuditAction, TargetKind
from .models import Account, Member, Product, ServiceTier, Workspace
from .problems import (
    AlreadyTaken,
    FieldError,
    LastProduct,
    NotFound,
    ProductInUse,
    ProductLimit,
    RevisionConflict,
    ValidationFailed,
)
from .repositories import AlreadyExists, Repositories, StaleVersion, Store

#: A Product's identifier in OEREP paths (RFC-0005).
PRODUCT_KEY = re.compile(r"^[a-z][a-z0-9_]*$")
MAX_NAME = 200
MAX_KEY = 64


def utcnow() -> datetime:
    return datetime.now(UTC)


class Deployment(StrEnum):
    """Where the service runs (``OE_DEPLOYMENT_MODE``). Only OpenEntitlement Cloud applies Cloud service tiers."""

    SELF_HOSTED = "self_hosted"
    SAAS = "saas"


#: Products each Cloud service tier allows; ``None`` is unlimited (ADR-0008).
PRODUCT_LIMITS: dict[ServiceTier, int | None] = {ServiceTier.PRO: 1, ServiceTier.ENTERPRISE: None}


def user_entitlements(deployment: Deployment, workspace: Workspace) -> bool:
    """Whether application users can have Personal terms and Grants: Cloud Enterprise or self-hosted (ADR-0005)."""
    return deployment is not Deployment.SAAS or workspace.service_tier is ServiceTier.ENTERPRISE


class HostingView(OpenEntitlementModel):
    """How OpenEntitlement runs the Workspace: self-hosted, or Cloud with its service tier."""

    mode: Deployment
    tier: ServiceTier
    #: Whether application users inside an Organization can have entitlements (Cloud Enterprise or self-hosted).
    subject_entitlements: bool
    #: How many Products the Workspace may have; ``None`` is unlimited.
    product_limit: int | None


class ProductView(OpenEntitlementModel):
    """A Product as its viewer sees it, with the viewer's Role in it."""

    id: UUID
    key: str
    name: str
    archived_at: datetime | None = None
    version: int
    role: str


class WorkspaceView(OpenEntitlementModel):
    """A Workspace with the Products its viewer can see."""

    id: UUID
    name: str
    role: str
    products: tuple[ProductView, ...]
    hosting: HostingView
    version: int


class WorkspaceSummary(OpenEntitlementModel):
    """One entry of the Workspace switcher."""

    id: UUID
    name: str
    role: str


@dataclass(frozen=True)
class OpenWorkspace:
    """One Workspace transaction and the Actor working in it. Operations take one."""

    repos: Repositories
    actor: Actor
    now: datetime


def product_key_from(name: str) -> str:
    """A Product key from a name: ``Big Data 2`` → ``big_data_2``. Always matches ``PRODUCT_KEY``."""
    ascii_name = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode()
    key = re.sub(r"[^a-z0-9]+", "_", ascii_name.lower()).strip("_")[:MAX_KEY].rstrip("_")
    if not key:
        return "product"
    return key if key[0].isalpha() else f"product_{key}"[:MAX_KEY].rstrip("_")


def _name(value: str, pointer: str) -> str:
    name = value.strip()
    if not name:
        raise ValidationFailed([FieldError(pointer, "Enter a name.")])
    if len(name) > MAX_NAME:
        raise ValidationFailed([FieldError(pointer, f"Use at most {MAX_NAME} characters.")])
    return name


def _view(product: Product, actor: Actor) -> ProductView:
    return ProductView(
        id=product.id,
        key=product.key,
        name=product.name,
        archived_at=product.archived_at,
        version=product.version,
        role=actor.role_in(product.id) or "",
    )



async def _audit_product(
    ws: OpenWorkspace, action: AuditAction, product: Product, before: Product | None, after: Product | None
) -> None:
    """Products are Workspace-wide: only Owners read their entries (ADR-0007)."""

    def fields(p: Product | None) -> dict[str, JsonValue] | None:
        return {"name": p.name, "key": p.key, "archivedAt": p.archived_at.isoformat() if p.archived_at else None} if p else None

    await audit.record(
        ws,
        action=action,
        target_kind=TargetKind.PRODUCT,
        target_id=str(product.id),
        target_name=(before or product).name,
        owners_only=True,
        changes=audit.diff(fields(before), fields(after)),
    )


def _product_list(products: Sequence[Product]) -> list[dict[str, str]]:
    return [{"id": str(p.id), "key": p.key, "name": p.name} for p in products]


class WorkspaceService:
    def __init__(
        self, store: Store, *, clock: Callable[[], datetime] = utcnow, deployment: Deployment = Deployment.SELF_HOSTED
    ) -> None:
        self.store, self.clock, self.deployment = store, clock, deployment

    def hosting(self, workspace: Workspace) -> HostingView:
        cloud = self.deployment is Deployment.SAAS
        return HostingView(
            mode=self.deployment,
            tier=workspace.service_tier,
            subject_entitlements=user_entitlements(self.deployment, workspace),
            product_limit=PRODUCT_LIMITS[workspace.service_tier] if cloud else None,
        )

    # Workspaces.

    async def create_workspace(self, account: Account, name: str) -> WorkspaceView:
        """A new Workspace with one Product named after it, owned by ``account``."""
        name = _name(name, "/name")
        now = self.clock()
        workspace = Workspace(id=uuid4(), name=name, created_at=now)
        product = Product(id=uuid4(), workspace_id=workspace.id, key=product_key_from(name), name=name, created_at=now)
        async with self.store.transaction(workspace.id) as repos:
            await repos.workspaces.add(workspace)
            await repos.products.add(product)
            await repos.members.add(Member(workspace_id=workspace.id, account_id=account.id, owner=True, created_at=now))
            actor = Actor(account=account, workspace_id=workspace.id, owner=True)
            # The creation is the Workspace's first audited change, in the same transaction, for Owners only (ADR-0007).
            ws = OpenWorkspace(repos=repos, actor=actor, now=now)
            await audit.record(
                ws,
                action=AuditAction.CREATED,
                target_kind=TargetKind.WORKSPACE,
                target_id=str(workspace.id),
                target_name=name,
                owners_only=True,
                changes=audit.diff(None, {"name": name}),
            )
            await _audit_product(ws, AuditAction.CREATED, product, None, product)
            await audit.record(
                ws,
                action=AuditAction.CREATED,
                target_kind=TargetKind.MEMBER,
                target_id=str(account.id),
                target_name=account.email,
                owners_only=True,
                changes=audit.diff(None, {"role": OWNER}),
            )
            return WorkspaceView(
                id=workspace.id,
                name=name,
                role=actor.role,
                products=(_view(product, actor),),
                hosting=self.hosting(workspace),
                version=workspace.version,
            )

    async def list_workspaces(self, account: Account) -> list[WorkspaceSummary]:
        """The Workspaces ``account`` is a member of, and every other one for a Platform administrator."""
        async with self.store.transaction(account_id=account.id) as repos:
            listed = {
                m.workspace.id: WorkspaceSummary(
                    id=m.workspace.id, name=m.workspace.name, role=OWNER if m.owner else highest(m.roles)
                )
                for m in await repos.directory.memberships()
            }
            if account.platform_admin:
                for workspace in await repos.directory.every_workspace():
                    listed.setdefault(
                        workspace.id, WorkspaceSummary(id=workspace.id, name=workspace.name, role=PLATFORM_ADMINISTRATOR)
                    )
        return sorted(listed.values(), key=lambda w: (w.name, str(w.id)))

    @asynccontextmanager
    async def open(self, account: Account, workspace_id: UUID) -> AsyncIterator[OpenWorkspace]:
        """One transaction in the Workspace, as ``account``. Not a member: ``not-found``, revealing nothing."""
        async with self.store.transaction(workspace_id) as repos:
            workspace = await repos.workspaces.get()
            member = await repos.members.get(account.id) if workspace else None
            if workspace is None or (member is None and not account.platform_admin):
                raise NotFound("This Workspace does not exist or you are not a member.")
            roles = {m.product_id: m.role for m in await repos.members.product_roles(account.id)} if member else {}
            actor = Actor(account=account, workspace_id=workspace_id, owner=bool(member and member.owner), roles=roles)
            yield OpenWorkspace(repos=repos, actor=actor, now=self.clock())

    async def view(self, ws: OpenWorkspace) -> WorkspaceView:
        workspace = await ws.repos.workspaces.get()
        assert workspace is not None  # open() checked it in this transaction
        products = tuple(_view(p, ws.actor) for p in await ws.repos.products.list() if ws.actor.sees(p.id))
        return WorkspaceView(
            id=workspace.id,
            name=workspace.name,
            role=ws.actor.role,
            products=products,
            hosting=self.hosting(workspace),
            version=workspace.version,
        )

    async def set_service_tier(self, ws: OpenWorkspace, *, tier: ServiceTier, version: int) -> WorkspaceView:
        """Change the Cloud service tier. Platform administrators only; Cloud only (ADR-0008).

        A downgrade to Cloud Pro is refused while the Workspace has more than one Product, archived
        ones included: its customers' applications would break.
        """
        ws.actor.require(Permission.SET_SERVICE_TIER)
        if self.deployment is not Deployment.SAAS:
            raise ValidationFailed([FieldError("/tier", "A self-hosted install has no Cloud service tier.")])
        await ws.repos.workspaces.lock()
        workspace = await ws.repos.workspaces.get()
        assert workspace is not None  # open() checked it in this transaction
        if workspace.version != version:
            raise RevisionConflict(kind="Workspace", id=str(workspace.id))
        limit = PRODUCT_LIMITS[tier]
        products = await ws.repos.products.list()
        if limit is not None and len(products) > limit:
            names = ", ".join(p.name for p in products)
            raise ProductLimit(
                f"Cloud {tier.value.title()} allows {limit} Product, and this Workspace has {len(products)}: {names}. "
                "Keep one and delete the others. Archive a Product customers use and move them off it before deleting it.",
                service_tier=tier.value,
                limit=limit,
                products=_product_list(products),
            )
        if tier is not workspace.service_tier:
            changed = workspace.model_copy(update={"service_tier": tier, "version": version + 1})
            try:
                await ws.repos.workspaces.update(changed, expected_version=version)
            except StaleVersion as exc:
                raise RevisionConflict(kind="Workspace", id=str(workspace.id)) from exc
            await audit.record(
                ws,
                action=AuditAction.CHANGED,
                target_kind=TargetKind.WORKSPACE,
                target_id=str(workspace.id),
                target_name=workspace.name,
                aspect=Aspect.SERVICE_TIER,
                owners_only=True,
                changes=audit.diff({"serviceTier": workspace.service_tier.value}, {"serviceTier": tier.value}),
            )
        return await self.view(ws)

    # Products.

    async def get_product(self, ws: OpenWorkspace, product_id: UUID) -> ProductView:
        ws.actor.require(Permission.READ_PRODUCT, product_id)
        return _view(await self._product(ws, product_id), ws.actor)

    async def create_product(self, ws: OpenWorkspace, *, key: str, name: str) -> ProductView:
        ws.actor.require(Permission.MANAGE_PRODUCTS)
        if not PRODUCT_KEY.fullmatch(key) or len(key) > MAX_KEY:
            detail = f"Use a lowercase letter, then lowercase letters, digits or underscores (at most {MAX_KEY})."
            raise ValidationFailed([FieldError("/key", detail)])
        product = Product(
            id=uuid4(), workspace_id=ws.actor.workspace_id, key=key, name=_name(name, "/name"), created_at=ws.now
        )
        await self._within_product_limit(ws)
        try:
            await ws.repos.products.add(product)
        except AlreadyExists as exc:
            raise AlreadyTaken(f"Another Product already uses the key {key}.", kind="Product", key=key) from exc
        await _audit_product(ws, AuditAction.CREATED, product, None, product)
        return _view(product, ws.actor)

    async def rename_product(self, ws: OpenWorkspace, product_id: UUID, *, name: str, version: int) -> ProductView:
        return await self._change(ws, product_id, version, AuditAction.CHANGED, name=_name(name, "/name"))

    async def archive_product(self, ws: OpenWorkspace, product_id: UUID, *, version: int) -> ProductView:
        """Archive: current customers keep the Product; it cannot be given to a new one (ADR-0008)."""
        current = await self._managed(ws, product_id, version)
        return await self._persist_change(ws, current, AuditAction.ARCHIVED, archived_at=current.archived_at or ws.now)

    async def restore_product(self, ws: OpenWorkspace, product_id: UUID, *, version: int) -> ProductView:
        return await self._change(ws, product_id, version, AuditAction.RESTORED, archived_at=None)

    async def delete_product(self, ws: OpenWorkspace, product_id: UUID, *, version: int) -> None:
        """Delete a Product that no customer uses, unless it is the Workspace's last one."""
        ws.actor.require(Permission.MANAGE_PRODUCTS, product_id)
        await ws.repos.products.lock_deletion()
        # The Product lock that Organization assignments take: none can be added between the check and the delete.
        await ws.repos.catalog.lock(product_id)
        current = await self._managed(ws, product_id, version)
        if await ws.repos.products.in_use(product_id):
            raise ProductInUse(id=str(product_id))
        if len(await ws.repos.products.list()) <= 1:
            raise LastProduct(id=str(product_id))
        try:
            await ws.repos.products.delete(product_id, expected_version=version)
        except StaleVersion as exc:
            raise RevisionConflict(kind="Product", id=str(product_id)) from exc
        await _audit_product(ws, AuditAction.DELETED, current, current, None)

    async def _within_product_limit(self, ws: OpenWorkspace) -> None:
        """Refuse another Product beyond the Cloud service tier's limit. Self-hosted installs have none."""
        if self.deployment is not Deployment.SAAS:
            return
        await ws.repos.workspaces.lock()
        workspace = await ws.repos.workspaces.get()
        assert workspace is not None  # open() checked it in this transaction
        limit = PRODUCT_LIMITS[workspace.service_tier]
        products = await ws.repos.products.list()
        if limit is not None and len(products) >= limit:
            raise ProductLimit(
                f"Cloud {workspace.service_tier.value.title()} allows {limit} Product. "
                "A Platform administrator can move this Workspace to Cloud Enterprise for more.",
                service_tier=workspace.service_tier.value,
                limit=limit,
                products=_product_list(products),
            )

    async def _product(self, ws: OpenWorkspace, product_id: UUID) -> Product:
        product = await ws.repos.products.get(product_id)
        if product is None:
            raise NotFound("This Product does not exist or you have no Role in it.")
        return product

    async def _managed(self, ws: OpenWorkspace, product_id: UUID, version: int) -> Product:
        """The Product at ``version``, once the Actor may manage Products."""
        ws.actor.require(Permission.MANAGE_PRODUCTS, product_id)
        product = await self._product(ws, product_id)
        if product.version != version:
            raise RevisionConflict(kind="Product", id=str(product_id))
        return product

    async def _change(
        self, ws: OpenWorkspace, product_id: UUID, version: int, action: AuditAction, **changes: Any
    ) -> ProductView:
        current = await self._managed(ws, product_id, version)
        return await self._persist_change(ws, current, action, **changes)

    async def _persist_change(self, ws: OpenWorkspace, current: Product, action: AuditAction, **changes: Any) -> ProductView:
        version, product_id = current.version, current.id
        changed = current.model_copy(update={**changes, "version": version + 1})
        try:
            await ws.repos.products.update(changed, expected_version=version)
        except StaleVersion as exc:
            raise RevisionConflict(kind="Product", id=str(product_id)) from exc
        await _audit_product(ws, action, changed, current, changed)
        return _view(changed, ws.actor)
