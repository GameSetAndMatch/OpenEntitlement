"""Members, their Roles per Product, and invitation links (ADR-0008).

A Product's Managers invite its Managers and Users, change their Roles in it and remove them;
Owners do this for every Product and also invite, appoint, change and remove Owners. The Members
list is filtered like the Audit log: a Manager sees the Owners and the members of the Products they
manage, with only those Products' Roles; an Owner sees everyone. A Workspace keeps at least one Owner.

An invitation is a single-use link that expires after seven days and only the invited email can
accept, once signed in with it verified. The link carries its Workspace's ID, so accepting it opens
only that Workspace; only a hash of the link is stored. Accepting never lowers or raises a Role the
Account already has: it adds the invited Product Role to a member who has none there.
"""
from __future__ import annotations

import re
from collections.abc import Callable
from datetime import datetime, timedelta
from enum import StrEnum
from uuid import UUID, uuid4

from openentitlement.model import OpenEntitlementModel

from .access import OWNER, Actor, Permission, highest
from .models import Account, Invitation, Member, ProductMembership, ProductRole
from .problems import (
    FieldError,
    InvitationForAnotherEmail,
    InvitationInvalid,
    LastOwner,
    NotFound,
    PermissionDenied,
    ValidationFailed,
)
from .repositories import Store
from .sign_in import digest, new_secret
from . import audit
from .audit import Aspect, AuditAction, TargetKind
from .workspaces import OpenWorkspace, utcnow

INVITATION_LIFETIME = timedelta(days=7)
MAX_EMAIL = 320
EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
_NOT_A_MEMBER = "This member does not exist or you cannot see them."


class InvitedRole(StrEnum):
    """The Roles an invitation or a Role change can give."""

    OWNER = OWNER
    MANAGER = ProductRole.MANAGER.value
    USER = ProductRole.USER.value


class MemberProductRole(OpenEntitlementModel):
    product_id: UUID
    role: ProductRole


class MemberView(OpenEntitlementModel):
    """A member as the viewer sees them: only the Roles in Products the viewer manages."""

    id: UUID
    email: str
    owner: bool
    #: The highest Role the viewer can see: Owner, then Manager, then User, else Member.
    role: str
    products: tuple[MemberProductRole, ...]


class InvitationLink(OpenEntitlementModel):
    """A new invitation. ``token`` is shown once; only its hash is stored."""

    token: str
    email: str
    role: InvitedRole
    product_id: UUID | None
    expires_at: datetime


class Joined(OpenEntitlementModel):
    """The result of accepting an invitation."""

    workspace_id: UUID
    #: True when the invitation changed nothing: the Account already had a Role in that Product, or is an Owner,
    #: or was invited as Owner while already a member. Roles of existing members change only from Members.
    already_member: bool
    #: The Account's Role in the invited Product (or Owner) after accepting.
    role: str


def _email(value: str) -> str:
    email = value.strip()
    if len(email) > MAX_EMAIL or not EMAIL.fullmatch(email):
        raise ValidationFailed([FieldError("/email", "Enter an email address, such as name@company.com.")])
    return email


def _role_and_product(role: InvitedRole | None, product_id: UUID | None) -> None:
    if role is InvitedRole.OWNER and product_id is not None:
        raise ValidationFailed([FieldError("/productId", "An Owner has every Product. Leave the Product out.")])
    if role is not InvitedRole.OWNER and product_id is None:
        raise ValidationFailed([FieldError("/productId", "Choose the Product this Role is for.")])


class MemberService:
    def __init__(self, store: Store, *, clock: Callable[[], datetime] = utcnow) -> None:
        self.store, self.clock = store, clock

    async def list_members(self, ws: OpenWorkspace) -> list[MemberView]:
        """Members of the Products the Actor manages, and the Owners; every member for an Owner."""
        actor = ws.actor
        order = [p.id for p in await ws.repos.products.list()]
        managed = actor.products_with(Permission.MANAGE_MEMBERS, order)
        if not actor.administers_workspace and not managed:
            raise PermissionDenied(
                "Only Managers and Owners can see the members.", permission=Permission.MANAGE_MEMBERS.value
            )
        roles = sorted(
            (r for r in await ws.repos.members.all_product_roles() if r.product_id in managed),
            key=lambda r: order.index(r.product_id),
        )
        listed = []
        for member in await ws.repos.members.list():
            visible = tuple(
                MemberProductRole(product_id=r.product_id, role=r.role) for r in roles if r.account_id == member.account_id
            )
            if not (member.owner or visible or actor.administers_workspace):
                continue
            account = await ws.repos.accounts.get(member.account_id)
            listed.append(
                MemberView(
                    id=member.account_id,
                    email=account.email if account else "",
                    owner=member.owner,
                    role=OWNER if member.owner else highest(r.role for r in visible),
                    products=visible,
                )
            )
        return sorted(listed, key=lambda m: (m.email.casefold(), str(m.id)))

    async def invite(
        self, ws: OpenWorkspace, *, email: str, role: InvitedRole, product_id: UUID | None = None
    ) -> InvitationLink:
        """An invitation link for ``email``: Owners invite anyone; a Product's Managers its Managers and Users."""
        _role_and_product(role, product_id)
        if role is InvitedRole.OWNER:
            ws.actor.require(Permission.MANAGE_OWNERS)
        else:
            ws.actor.require(Permission.MANAGE_MEMBERS, product_id)
            await self._existing_product(ws, product_id)
        email = _email(email)
        token = f"{ws.actor.workspace_id}.{new_secret()}"
        invitation = Invitation(
            id=uuid4(),
            workspace_id=ws.actor.workspace_id,
            token_hash=digest(token),
            email=email,
            owner=role is InvitedRole.OWNER,
            product_id=product_id,
            role=None if role is InvitedRole.OWNER else ProductRole(role.value),
            invited_by=ws.actor.account.id,
            created_at=ws.now,
            expires_at=ws.now + INVITATION_LIFETIME,
        )
        await ws.repos.invitations.add(invitation, now=ws.now)
        await audit.record(
            ws,
            action=AuditAction.INVITED,
            target_kind=TargetKind.MEMBER,
            target_id=str(invitation.id),
            target_name=email,
            product_id=product_id,
            owners_only=invitation.owner,
            changes=audit.diff(None, {"role": role.value}),
        )
        return InvitationLink(
            token=token, email=email, role=role, product_id=product_id, expires_at=invitation.expires_at
        )

    async def accept(self, account: Account, token: str) -> Joined:
        """Join the invitation's Workspace with the invited Role. Each link works once, for seven days."""
        workspace_part, _, secret = token.partition(".")
        try:
            workspace_id = UUID(workspace_part)
        except ValueError:
            raise InvitationInvalid() from None
        if not secret:
            raise InvitationInvalid()
        now = self.clock()
        async with self.store.transaction(workspace_id) as repos:
            # The Workspace lock comes first, as in every membership and Product change, so taking the
            # invitation cannot deadlock with a Product deletion that cascades to it.
            await repos.workspaces.lock()
            invitation = await repos.invitations.take(digest(token), now=now)
            if invitation is None or await repos.workspaces.get() is None:
                raise InvitationInvalid()
            if invitation.email.casefold() != account.email.casefold():
                # Raising rolls the transaction back, so the invited person can still use the link.
                raise InvitationForAnotherEmail()
            member = await repos.members.get(account.id)
            current = {r.product_id: r.role for r in await repos.members.product_roles(account.id)} if member else {}
            unchanged = member is not None and (member.owner or invitation.owner or invitation.product_id in current)
            if member is None:
                await repos.members.add(
                    Member(workspace_id=workspace_id, account_id=account.id, owner=invitation.owner, created_at=now)
                )
            if not unchanged and invitation.product_id is not None and invitation.role is not None:
                await repos.members.set_product_role(
                    ProductMembership(
                        workspace_id=workspace_id,
                        product_id=invitation.product_id,
                        account_id=account.id,
                        role=invitation.role,
                    )
                )
                current[invitation.product_id] = invitation.role
            owner = invitation.owner if member is None else member.owner
            if owner:
                role = OWNER
            elif invitation.product_id is not None and invitation.product_id in current:
                role = current[invitation.product_id].value
            else:
                role = highest(current.values())
            if not unchanged:
                ws = OpenWorkspace(repos=repos, actor=Actor(account=account, workspace_id=workspace_id), now=now)
                await audit.record(
                    ws,
                    action=AuditAction.JOINED,
                    target_kind=TargetKind.MEMBER,
                    target_id=str(account.id),
                    target_name=account.email,
                    product_id=invitation.product_id,
                    owners_only=role == OWNER,
                    changes=audit.diff(None, {"role": role}),
                )
        return Joined(workspace_id=workspace_id, already_member=unchanged, role=role)

    async def set_role(
        self, ws: OpenWorkspace, account_id: UUID, *, role: InvitedRole | None, product_id: UUID | None = None
    ) -> None:
        """Give a member ``role``: Owner of the Workspace, or Manager, User or no Role in one Product.

        A member whose last Product Role is cleared leaves the Workspace.
        Making someone Owner, or changing an Owner's Role (which ends their being Owner), needs an Owner.
        """
        if role is None and product_id is None:
            raise ValidationFailed([FieldError("/productId", "Choose the Product to remove this member from.")])
        if role is not None:
            _role_and_product(role, product_id)
        # Serialize membership changes in the Workspace: every check below reads Roles that a
        # concurrent change could otherwise make stale (last Owner, last Role, Owner promotion).
        await ws.repos.workspaces.lock()
        if role is InvitedRole.OWNER:
            ws.actor.require(Permission.MANAGE_OWNERS)
            member = await self._member(ws, account_id)
            if not member.owner:
                before = await self._role(ws, member, None)
                # An Owner has every Product; a later change of Role names the Product it is for.
                for role_in_product in await ws.repos.members.product_roles(account_id):
                    await ws.repos.members.remove_product_role(role_in_product.product_id, account_id)
                await ws.repos.members.set_owner(account_id, True)
                await self._audit_role(ws, member, None, before=before, after=OWNER)
            return
        assert product_id is not None
        ws.actor.require(Permission.MANAGE_MEMBERS, product_id)
        await self._existing_product(ws, product_id)
        member = await self._member(ws, account_id)
        before = await self._role(ws, member, product_id)
        if member.owner:
            ws.actor.require(Permission.MANAGE_OWNERS)
            if role is None:
                raise ValidationFailed(
                    [FieldError("/role", "An Owner has every Product. Choose Manager or User to end their being Owner.")]
                )
            await self._keep_another_owner(ws, member)
            await ws.repos.members.set_owner(account_id, False)
        if role is None:
            await ws.repos.members.remove_product_role(product_id, account_id)
            # A member left without any Role leaves the Workspace (ADR-0008).
            if not await ws.repos.members.product_roles(account_id):
                await ws.repos.members.remove(account_id)
        else:
            await ws.repos.members.set_product_role(
                ProductMembership(
                    workspace_id=ws.actor.workspace_id,
                    product_id=product_id,
                    account_id=account_id,
                    role=ProductRole(role.value),
                )
            )
        after = role.value if role else None
        if before != after:
            await self._audit_role(ws, member, product_id, before=before, after=after)

    async def remove(self, ws: OpenWorkspace, account_id: UUID) -> None:
        """Remove a member: from the Workspace for an Owner; from the Products they manage for a Manager.

        A member left without any Role after a Manager removes them leaves the Workspace.
        """
        actor = ws.actor
        await ws.repos.workspaces.lock()
        member = await self._member(ws, account_id)
        email = await self._email_of(ws, member)
        if actor.administers_workspace:
            if member.owner:
                await self._keep_another_owner(ws, member)
            if member.owner:
                removed = audit.diff({"role": OWNER}, None)
            else:
                roles = await ws.repos.members.product_roles(account_id)
                removed = await self._role_changes(ws, {r.product_id: r.role.value for r in roles})
            await ws.repos.members.remove(account_id)
            await self._audit_removal(ws, account_id, email, removed, owners_only=member.owner)
            return
        if member.owner:
            raise PermissionDenied(
                "Only the Workspace's Owners can remove an Owner.",
                permission=Permission.MANAGE_OWNERS.value,
            )
        roles = await ws.repos.members.product_roles(account_id)
        managed = actor.products_with(Permission.MANAGE_MEMBERS, [r.product_id for r in roles])
        if not managed:
            raise NotFound(_NOT_A_MEMBER)
        for role in roles:
            if role.product_id in managed:
                await ws.repos.members.remove_product_role(role.product_id, account_id)
        if len(managed) == len(roles):
            await ws.repos.members.remove(account_id)
        removed = await self._role_changes(ws, {r.product_id: r.role.value for r in roles if r.product_id in managed})
        await self._audit_removal(ws, account_id, email, removed, owners_only=False)

    async def _role_changes(self, ws: OpenWorkspace, roles: dict[UUID, str]) -> list[audit.AuditChange]:
        """A member's removed Role in each Product: each read only by that Product's Managers (ADR-0007)."""
        names = await audit.product_names(ws)
        return [
            change
            for product_id, role in sorted(roles.items(), key=lambda item: names.get(item[0], ""))
            for change in audit.diff(
                {"role": role}, None, product_id=product_id, product_name=names.get(product_id)
            )
        ]

    async def _audit_removal(
        self, ws: OpenWorkspace, account_id: UUID, email: str, removed: list[audit.AuditChange], *, owners_only: bool
    ) -> None:
        await audit.record(
            ws,
            action=AuditAction.REMOVED,
            target_kind=TargetKind.MEMBER,
            target_id=str(account_id),
            target_name=email,
            owners_only=owners_only,
            changes=removed,
        )

    async def _member(self, ws: OpenWorkspace, account_id: UUID) -> Member:
        member = await ws.repos.members.get(account_id)
        if member is None:
            raise NotFound(_NOT_A_MEMBER)
        return member

    async def _existing_product(self, ws: OpenWorkspace, product_id: UUID | None) -> None:
        # require() already hid Products the Actor has no Role in; this catches deleted ones for Owners.
        if product_id is None or await ws.repos.products.get(product_id) is None:
            raise NotFound("This Product does not exist or you have no Role in it.")

    async def _keep_another_owner(self, ws: OpenWorkspace, member: Member) -> None:
        await ws.repos.workspaces.lock()
        owners = [m for m in await ws.repos.members.list() if m.owner]
        if [m.account_id for m in owners] == [member.account_id]:
            raise LastOwner(id=str(member.account_id))

    async def _role(self, ws: OpenWorkspace, member: Member, product_id: UUID | None) -> str | None:
        if member.owner:
            return OWNER
        roles = await ws.repos.members.product_roles(member.account_id)
        if product_id is None:
            return highest(r.role for r in roles)
        return next((r.role.value for r in roles if r.product_id == product_id), None)

    async def _email_of(self, ws: OpenWorkspace, member: Member) -> str:
        account = await ws.repos.accounts.get(member.account_id)
        return account.email if account else ""

    async def _audit_role(
        self, ws: OpenWorkspace, member: Member, product_id: UUID | None, *, before: str | None, after: str | None
    ) -> None:
        owners_only = OWNER in (before, after)
        await audit.record(
            ws,
            action=AuditAction.CHANGED,
            target_kind=TargetKind.MEMBER,
            target_id=str(member.account_id),
            target_name=await self._email_of(ws, member),
            aspect=Aspect.ROLE,
            product_id=None if owners_only else product_id,
            owners_only=owners_only,
            changes=audit.diff({"role": before}, {"role": after}),
        )
