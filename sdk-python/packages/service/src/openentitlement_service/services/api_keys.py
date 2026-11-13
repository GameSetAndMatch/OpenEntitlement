"""API keys: how an application evaluates one Product over OEREP (ADR-0008, RFC-0005, OPE-42).

A key belongs to one Workspace and one Product. Its secret is shown once, when it is created; only
its SHA-256 hash is stored. The secret starts with the Workspace's ID, so evaluation opens a
transaction bound to that Workspace before looking the key up, as invitation links do: no lookup
ever crosses Workspaces. Revoking a key deletes it. A Product's Managers and the Workspace's Owners
create and revoke its keys; an archived Product gets no new keys, while its existing keys keep
evaluating, because an archived Product keeps serving its customers.
"""
from __future__ import annotations

from collections.abc import Sequence
from datetime import datetime
from uuid import UUID, uuid4

from openentitlement.model import OpenEntitlementModel
from pydantic import Field

from .access import Permission
from .models import Product
from .problems import FieldError, NotFound, ValidationFailed
from .sign_in import digest, new_secret
from .workspaces import OpenWorkspace, audit_settings

#: Marks an OpenEntitlement API key, so secret scanners and people recognize one.
KEY_PREFIX = "oek_"
MAX_KEY_NAME = 200
#: The characters of the secret shown again after creation, to tell keys apart.
HINT_LENGTH = 4


class ApiKey(OpenEntitlementModel):
    """A stored API key. ``token_hash`` is the SHA-256 of the whole secret."""

    id: UUID
    workspace_id: UUID
    product_id: UUID
    name: str
    token_hash: str
    #: The last characters of the secret.
    hint: str
    created_by: UUID
    created_at: datetime


class ApiKeyView(OpenEntitlementModel):
    id: UUID
    product_id: UUID
    name: str
    #: How the console shows the key without its secret: ``oek_…abcd``.
    preview: str
    created_at: datetime


class NewApiKey(ApiKeyView):
    """A key just created. ``secret`` is shown this once and never again."""

    secret: str = Field(description="The API key. Store it now: it is never shown again.")


def _view(key: ApiKey) -> ApiKeyView:
    return ApiKeyView(
        id=key.id, product_id=key.product_id, name=key.name, preview=f"{KEY_PREFIX}…{key.hint}", created_at=key.created_at
    )


def parse_key(secret: str) -> tuple[UUID, str] | None:
    """The Workspace a secret names and the secret, or None when it is not shaped like an API key."""
    if not secret.startswith(KEY_PREFIX):
        return None
    workspace_part, _, rest = secret[len(KEY_PREFIX):].partition(".")
    if not rest:
        return None
    try:
        return UUID(workspace_part), secret
    except ValueError:
        return None


class ApiKeyService:
    async def _product(self, ws: OpenWorkspace, product_id: UUID) -> Product:
        ws.actor.require(Permission.EDIT_PRODUCT, product_id)
        await ws.repos.catalog.lock(product_id)
        product = await ws.repos.products.get(product_id)
        if product is None:
            raise NotFound("This Product does not exist or you have no Role in it.")
        return product

    async def list(self, ws: OpenWorkspace, product_id: UUID) -> Sequence[ApiKeyView]:
        """The Product's keys, newest first, without their secrets. Its Managers and the Owners only."""
        await self._product(ws, product_id)
        keys = await ws.repos.api_keys.list(product_id)
        return [_view(k) for k in sorted(keys, key=lambda k: (k.created_at, k.name), reverse=True)]

    async def create(self, ws: OpenWorkspace, product_id: UUID, *, name: str) -> NewApiKey:
        product = await self._product(ws, product_id)
        name = name.strip()
        if not name:
            raise ValidationFailed([FieldError("/name", "Enter a name, such as the application that uses the key.")])
        if len(name) > MAX_KEY_NAME:
            raise ValidationFailed([FieldError("/name", f"Use at most {MAX_KEY_NAME} characters.")])
        if product.archived_at is not None:
            raise ValidationFailed([FieldError("", "This Product is archived: it gets no new API keys. Restore it first.")])
        secret = f"{KEY_PREFIX}{ws.actor.workspace_id}.{new_secret()}"
        key = ApiKey(
            id=uuid4(),
            workspace_id=ws.actor.workspace_id,
            product_id=product_id,
            name=name,
            token_hash=digest(secret),
            hint=secret[-HINT_LENGTH:],
            created_by=ws.actor.account.id,
            created_at=ws.now,
        )
        await ws.repos.api_keys.add(key)
        await audit_settings(
            ws, action="api-key.created", target_kind="API key", target_id=str(key.id), target_name=name, product_id=product_id
        )
        return NewApiKey(**_view(key).model_dump(), secret=secret)

    async def revoke(self, ws: OpenWorkspace, product_id: UUID, key_id: UUID) -> None:
        """Delete the key: applications using it get ``api-key-invalid`` from their next request."""
        await self._product(ws, product_id)
        key = await ws.repos.api_keys.get(key_id)
        if key is None or key.product_id != product_id:
            raise NotFound("This API key does not exist. It may have been revoked already.")
        await ws.repos.api_keys.delete(key_id)
        await audit_settings(
            ws, action="api-key.revoked", target_kind="API key", target_id=str(key.id), target_name=key.name, product_id=product_id
        )
