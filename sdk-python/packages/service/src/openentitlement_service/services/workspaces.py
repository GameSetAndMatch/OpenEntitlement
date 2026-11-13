"""Workspaces and their Products (ADR-0008).

A Workspace starts with one Product, and its creator is its Owner. Members see only the Products
where they have a Role; Owners and Platform administrators see all of them. Only Owners (and
Platform administrators) create, rename, archive, restore and delete Products. A Product's ID and
key never change.
"""
from __future__ import annotations

import re
import unicodedata
from collections.abc import AsyncIterator, Callable
from contextlib import asynccontextmanager
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any
from uuid import UUID, uuid4

from openentitlement.model import OpenEntitlementModel

from .access import PLATFORM_ADMINISTRATOR, Actor, Permission, highest, OWNER
from .models import Account, Member, Product, Workspace
from .problems import AlreadyTaken, FieldError, LastProduct, NotFound, ProductInUse, RevisionConflict, ValidationFailed
from .repositories import AlreadyExists, Repositories, StaleVersion, Store

#: A Product's identifier in OEREP paths (RFC-0005).
PRODUCT_KEY = re.compile(r"^[a-z][a-z0-9_]*$")
MAX_NAME = 200
MAX_KEY = 64


def utcnow() -> datetime:
    return datetime.now(UTC)


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


class WorkspaceService:
    def __init__(self, store: Store, *, clock: Callable[[], datetime] = utcnow) -> None:
        self.store, self.clock = store, clock

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
            return WorkspaceView(id=workspace.id, name=name, role=actor.role, products=(_view(product, actor),))

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
        return WorkspaceView(id=workspace.id, name=workspace.name, role=ws.actor.role, products=products)

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
        try:
            await ws.repos.products.add(product)
        except AlreadyExists as exc:
            raise AlreadyTaken(f"Another Product already uses the key {key}.", kind="Product", key=key) from exc
        return _view(product, ws.actor)

    async def rename_product(self, ws: OpenWorkspace, product_id: UUID, *, name: str, version: int) -> ProductView:
        return await self._change(ws, product_id, version, name=_name(name, "/name"))

    async def archive_product(self, ws: OpenWorkspace, product_id: UUID, *, version: int) -> ProductView:
        """Archive: current customers keep the Product; it cannot be given to a new one (ADR-0008)."""
        current = await self._managed(ws, product_id, version)
        return await self._change(ws, product_id, version, archived_at=current.archived_at or ws.now)

    async def restore_product(self, ws: OpenWorkspace, product_id: UUID, *, version: int) -> ProductView:
        return await self._change(ws, product_id, version, archived_at=None)

    async def delete_product(self, ws: OpenWorkspace, product_id: UUID, *, version: int) -> None:
        """Delete a Product that no customer uses, unless it is the Workspace's last one."""
        await self._managed(ws, product_id, version)
        if await ws.repos.products.in_use(product_id):
            raise ProductInUse(id=str(product_id))
        if len(await ws.repos.products.list()) <= 1:
            raise LastProduct(id=str(product_id))
        try:
            await ws.repos.products.delete(product_id, expected_version=version)
        except StaleVersion as exc:
            raise RevisionConflict(kind="Product", id=str(product_id)) from exc

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

    async def _change(self, ws: OpenWorkspace, product_id: UUID, version: int, **changes: Any) -> ProductView:
        current = await self._managed(ws, product_id, version)
        changed = current.model_copy(update={**changes, "version": version + 1})
        try:
            await ws.repos.products.update(changed, expected_version=version)
        except StaleVersion as exc:
            raise RevisionConflict(kind="Product", id=str(product_id)) from exc
        return _view(changed, ws.actor)
