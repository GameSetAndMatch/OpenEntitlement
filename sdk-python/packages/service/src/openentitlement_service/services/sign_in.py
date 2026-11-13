"""Console sign-in rules: who may sign in, Accounts, sessions and sign-out (ADR-0009).

The OIDC exchange itself (redirects, tokens, signatures) belongs to the HTTP interface. This layer
receives a verified identity and decides: the email must be verified, its domain allowed when a
list is set, and the configured subject becomes a Platform administrator. Session and sign-in flow
secrets are random; only their SHA-256 hashes are stored.
"""
from __future__ import annotations

import hashlib
import secrets
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from uuid import uuid4

from .models import Account, Session, SignInFlow
from .problems import SignInFailed, SignInRefused, SignInRequired
from .repositories import Store
from .workspaces import utcnow

SESSION_LIFETIME = timedelta(hours=12)
FLOW_LIFETIME = timedelta(minutes=10)


def new_secret() -> str:
    """256 random bits, URL-safe."""
    return secrets.token_urlsafe(32)


def digest(secret: str) -> str:
    return hashlib.sha256(secret.encode()).hexdigest()


@dataclass(frozen=True)
class SignInPolicy:
    #: The OIDC issuer Accounts are created for.
    issuer: str
    #: The subject that becomes a Platform administrator when it signs in.
    platform_admin_subject: str | None = None
    #: Email domains allowed to sign in; empty allows every domain.
    allowed_domains: frozenset[str] = field(default_factory=frozenset)


@dataclass(frozen=True)
class VerifiedIdentity:
    """The identity the OIDC issuer vouched for, after its signature and claims were checked."""

    subject: str
    email: str
    email_verified: bool


@dataclass(frozen=True)
class PendingSignIn:
    """A sign-in flow just started: ``token`` goes in a cookie, the rest in the authorization request."""

    token: str
    state: str
    nonce: str
    verifier: str


@dataclass(frozen=True)
class NewSession:
    token: str
    account: Account
    csrf: str


@dataclass(frozen=True)
class SignedIn:
    """The Account behind a valid session, and the session's CSRF token."""

    account: Account
    csrf: str


class SignInService:
    def __init__(self, store: Store, policy: SignInPolicy, *, clock: Callable[[], datetime] = utcnow) -> None:
        self.store, self.policy, self.clock = store, policy, clock

    async def start(self) -> PendingSignIn:
        pending = PendingSignIn(token=new_secret(), state=new_secret(), nonce=new_secret(), verifier=new_secret())
        now = self.clock()
        flow = SignInFlow(
            flow_hash=digest(pending.token),
            state=pending.state,
            nonce=pending.nonce,
            verifier=pending.verifier,
            expires_at=now + FLOW_LIFETIME,
        )
        async with self.store.transaction() as repos:
            await repos.sign_in_flows.add(flow, now=now)
        return pending

    async def resume(self, token: str) -> SignInFlow:
        """The flow ``token`` started. Each flow resumes once, within ten minutes."""
        async with self.store.transaction() as repos:
            flow = await repos.sign_in_flows.take(digest(token), now=self.clock()) if token else None
        if flow is None:
            raise SignInFailed("Sign-in expired. Start again.")
        return flow

    async def finish(self, identity: VerifiedIdentity) -> NewSession:
        if not identity.email_verified:
            raise SignInRefused("Sign-in requires a verified email address.", reason="email-not-verified")
        domain = identity.email.rpartition("@")[2].lower()
        if self.policy.allowed_domains and domain not in self.policy.allowed_domains:
            raise SignInRefused("Your email domain cannot sign in here.", reason="domain-not-allowed")
        now = self.clock()
        token, csrf = new_secret(), new_secret()
        async with self.store.transaction() as repos:
            account = await repos.accounts.sign_in(
                Account(
                    id=uuid4(),
                    issuer=self.policy.issuer,
                    subject=identity.subject,
                    email=identity.email,
                    platform_admin=identity.subject == self.policy.platform_admin_subject,
                    created_at=now,
                )
            )
            session = Session(token_hash=digest(token), account_id=account.id, csrf=csrf, expires_at=now + SESSION_LIFETIME)
            await repos.sessions.add(session)
        return NewSession(token=token, account=account, csrf=csrf)

    async def authenticate(self, token: str) -> SignedIn:
        """The Account of a valid session, or ``sign-in-required``."""
        if token:
            async with self.store.transaction() as repos:
                session = await repos.sessions.get(digest(token), now=self.clock())
                account = await repos.accounts.get(session.account_id) if session else None
            if session and account:
                return SignedIn(account=account, csrf=session.csrf)
        raise SignInRequired()

    async def sign_out(self, token: str) -> None:
        async with self.store.transaction() as repos:
            await repos.sessions.delete(digest(token))
