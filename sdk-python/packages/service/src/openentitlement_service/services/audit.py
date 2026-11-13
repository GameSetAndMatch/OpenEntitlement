"""The Audit log: who changed what, recorded when the change is made, read by Managers and Owners (ADR-0007).

Every write records one ``AuditEntry`` in its own transaction. The entry names its target as it was
at that moment (kind, ID and name) and lists only the values that changed, before → after. Each
changed value carries the Product it belongs to, so a reader sees only their Products' values:

- Owners and Platform administrators read every entry in full.
- A Product's Manager reads the entries about the Products they manage, and, of an entry about a
  shared record (an Organization, a member), only the values that are not another Product's.
- Workspace-wide entries (Products, Owners, the Cloud service tier) are for Owners only.
- Anyone else, a User included, is refused: the log shows members' emails.
"""
from __future__ import annotations

from collections.abc import Iterable, Mapping, Sequence
from datetime import datetime
from enum import StrEnum
from typing import TYPE_CHECKING
from uuid import UUID, uuid4

from pydantic import JsonValue

from openentitlement.model import OpenEntitlementModel

from .access import Permission
from .models import ProductRole

if TYPE_CHECKING:
    from .workspaces import OpenWorkspace

#: At most this many entries are returned per page.
MAX_PAGE = 200
#: Bookkeeping members that never appear as a changed value: the target already names the record.
_IGNORED = frozenset(
    {"version", "workspaceId", "productId", "organizationId", "subjectId", "tierId", "id", "key", "createdAt"}
)


class AuditAction(StrEnum):
    CREATED = "created"
    CHANGED = "changed"
    ARCHIVED = "archived"
    RESTORED = "restored"
    DELETED = "deleted"
    REMOVED = "removed"
    INVITED = "invited"
    JOINED = "joined"


class TargetKind(StrEnum):
    """The kind of record an entry is about, as the sentence names it ("Organization Acme")."""

    WORKSPACE = "Workspace"
    PRODUCT = "Product"
    PRIVILEGE = "Privilege"
    GROUP = "Group"
    TAG = "Tag"
    TIER = "Tier"
    TIER_VARIANT = "Tier variant"
    STATUS_POLICY = "Status policy"
    ORGANIZATION = "Organization"
    APPLICATION_USER = "Application user"
    MEMBER = "Member"


class Aspect(StrEnum):
    """Which part of the target changed, when the sentence names it ("changed Organization Acme's terms")."""

    #: Organization terms, or an application user's Personal terms and Grants.
    TERMS = "terms"
    #: An Organization's Tier variant or contract status in a Product.
    TIER = "tier"
    #: A member's Role.
    ROLE = "role"
    #: The Workspace's Cloud service tier.
    SERVICE_TIER = "serviceTier"


class AuditChange(OpenEntitlementModel):
    """One changed value, before → after. ``None`` is "not set"."""

    #: A dotted path into the record (``name``, ``terms.seats``, ``values.pro_standard``).
    field: str
    #: The human name of the value at that moment, such as a Privilege's or variant's title.
    title: str | None = None
    before: JsonValue = None
    after: JsonValue = None
    #: The Product this value belongs to, when the entry is about a shared record; ``None`` otherwise.
    product_id: UUID | None = None
    product_name: str | None = None


class AuditEntry(OpenEntitlementModel):
    """An immutable audit entry, as written."""

    id: UUID
    workspace_id: UUID
    actor_id: UUID
    actor_email: str
    at: datetime
    action: AuditAction
    target_kind: TargetKind
    target_id: str
    #: The target's name when the change was made; never looked up again.
    target_name: str
    aspect: Aspect | None = None
    #: The Product the whole entry is about; ``None`` for a shared or Workspace-wide record.
    product_id: UUID | None = None
    product_name: str | None = None
    #: Products, Owners and the Cloud service tier: only Owners and Platform administrators read it.
    owners_only: bool = False
    changes: tuple[AuditChange, ...] = ()
    #: Why Organization terms, Personal terms or Grants changed.
    reason: str | None = None

    @property
    def products(self) -> frozenset[UUID]:
        """Every Product the entry, or one of its values, belongs to."""
        found = {c.product_id for c in self.changes if c.product_id is not None}
        return frozenset(found | ({self.product_id} if self.product_id else set()))

    @property
    def shared(self) -> bool:
        """Whether every Manager may read it: a shared record with something that is no Product's."""
        if self.owners_only or self.product_id is not None:
            return False
        return not self.changes or any(c.product_id is None for c in self.changes)

    def visible_to(self, managed: frozenset[UUID]) -> bool:
        return not self.owners_only and (self.shared or bool(self.products & managed))

    def projected(self, managed: frozenset[UUID] | None) -> AuditEntry:
        """The entry with only the values a Manager of ``managed`` may read (``None`` reads everything)."""
        if managed is None:
            return self
        changes = tuple(c for c in self.changes if c.product_id is None or c.product_id in managed)
        return self.model_copy(update={"changes": changes, "reason": self.reason if len(changes) == len(self.changes) else None})


class AuditEntryView(OpenEntitlementModel):
    """An entry as its reader sees it."""

    id: UUID
    at: datetime
    actor_email: str
    action: AuditAction
    target_kind: TargetKind
    target_id: str
    target_name: str
    aspect: Aspect | None
    product_id: UUID | None
    product_name: str | None
    changes: tuple[AuditChange, ...]
    reason: str | None


class AuditLogView(OpenEntitlementModel):
    """A page of the Audit log, newest first. ``next`` continues it; ``None`` at the oldest entry."""

    entries: tuple[AuditEntryView, ...]
    next: int | None = None


def diff(
    before: Mapping[str, JsonValue] | None,
    after: Mapping[str, JsonValue] | None,
    *,
    titles: Mapping[str, str] | None = None,
    ignore: Iterable[str] = (),
    product_id: UUID | None = None,
    product_name: str | None = None,
) -> list[AuditChange]:
    """The values that differ between two JSON records, as flat dotted paths.

    ``titles`` names the last segment of a path at that moment, such as a Privilege key's title in
    ``terms.seats``, or a top-level path in full.
    """
    skipped = _IGNORED | set(ignore)
    flat_before, flat_after = _flatten(before or {}, skipped), _flatten(after or {}, skipped)
    titles = titles or {}
    changes = []
    for path in sorted(flat_before.keys() | flat_after.keys(), key=_order(flat_before, flat_after)):
        old, new = flat_before.get(path), flat_after.get(path)
        if old != new and not (_blank(old) and _blank(new)):
            title = titles.get(path) or titles.get(path.rsplit(".", 1)[-1]) if "." in path else titles.get(path)
            changes.append(
                AuditChange(
                    field=path, title=title, before=old, after=new, product_id=product_id, product_name=product_name
                )
            )
    return changes


def _blank(value: JsonValue) -> bool:
    # An empty description or Tag list on a new record is no change worth listing.
    return value is None or value == "" or value == []


def _order(*records: Mapping[str, JsonValue]):  # type: ignore[no-untyped-def]
    # Keep the record's own field order: name before rank before nested values.
    positions: dict[str, int] = {}
    for record in records:
        for path in record:
            positions.setdefault(path, len(positions))
    return lambda path: positions[path]


def _flatten(record: Mapping[str, JsonValue], skipped: frozenset[str] | set[str], prefix: str = "") -> dict[str, JsonValue]:
    flat: dict[str, JsonValue] = {}
    for key, value in record.items():
        if not prefix and key in skipped:
            continue
        path = f"{prefix}{key}"
        if isinstance(value, dict):
            # An empty mapping adds nothing: removing the last term reads as that term's removal.
            flat.update(_flatten(value, skipped, f"{path}."))
        else:
            flat[path] = value
    return flat


async def record(
    ws: OpenWorkspace,
    *,
    action: AuditAction,
    target_kind: TargetKind,
    target_id: str,
    target_name: str,
    changes: Sequence[AuditChange] = (),
    product_id: UUID | None = None,
    aspect: Aspect | None = None,
    owners_only: bool = False,
    reason: str | None = None,
) -> None:
    """Record who changed what, in the transaction of the change itself.

    ``product_id`` scopes the whole entry to one Product, whose name is recorded as it is now. A save
    that changed nothing records nothing.
    """
    if action is AuditAction.CHANGED and not changes:
        return
    product_name = None
    if product_id is not None:
        product = await ws.repos.products.get(product_id)
        product_name = product.name if product else None
    await ws.repos.audit.add(
        AuditEntry(
            id=uuid4(),
            workspace_id=ws.actor.workspace_id,
            actor_id=ws.actor.account.id,
            actor_email=ws.actor.account.email,
            at=ws.now,
            action=action,
            target_kind=target_kind,
            target_id=target_id,
            target_name=target_name,
            aspect=aspect,
            product_id=product_id,
            product_name=product_name,
            owners_only=owners_only,
            changes=tuple(changes),
            reason=reason,
        )
    )


async def product_names(ws: OpenWorkspace) -> dict[UUID, str]:
    """Every Product's name now, for values of a shared record that belong to several Products."""
    return {p.id: p.name for p in await ws.repos.products.list()}


class AuditService:
    async def log(self, ws: OpenWorkspace, *, limit: int = 50, before: int | None = None) -> AuditLogView:
        """A page of the entries the Actor may read, newest first, starting before ``before``."""
        ws.actor.require(Permission.READ_AUDIT_LOG)
        actor = ws.actor
        managed = (
            None
            if actor.administers_workspace
            else frozenset(p for p, role in actor.roles.items() if role is ProductRole.MANAGER)
        )
        limit = max(1, min(limit, MAX_PAGE))
        page = await ws.repos.audit.list(managed=managed, limit=limit + 1, before=before)
        entries = [entry.projected(managed) for _, entry in page[:limit]]
        return AuditLogView(
            entries=tuple(
                AuditEntryView(
                    id=e.id,
                    at=e.at,
                    actor_email=e.actor_email,
                    action=e.action,
                    target_kind=e.target_kind,
                    target_id=e.target_id,
                    target_name=e.target_name,
                    aspect=e.aspect,
                    product_id=e.product_id,
                    product_name=e.product_name,
                    changes=e.changes,
                    reason=e.reason,
                )
                for e in entries
            ),
            next=page[limit - 1][0] if len(page) > limit else None,
        )
