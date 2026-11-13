"""Service layer with in-memory repositories: sign-in rules, sessions and sign-out."""
from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest

from openentitlement_service.repositories.memory import InMemoryStore
from openentitlement_service.services.problems import SignInFailed, SignInRefused, SignInRequired
from openentitlement_service.services.sign_in import SignInPolicy, SignInService, VerifiedIdentity

pytestmark = pytest.mark.anyio
ISSUER = "https://id.acme.test"


class Clock:
    def __init__(self) -> None:
        self.now = datetime(2026, 11, 13, 9, 30, tzinfo=UTC)

    def __call__(self) -> datetime:
        return self.now


@pytest.fixture
def clock() -> Clock:
    return Clock()


def service(clock: Clock, **policy: object) -> SignInService:
    return SignInService(InMemoryStore(), SignInPolicy(issuer=ISSUER, **policy), clock=clock)  # type: ignore[arg-type]


def alice(email: str = "alice@acme.test", *, verified: bool = True) -> VerifiedIdentity:
    return VerifiedIdentity(subject="alice", email=email, email_verified=verified)


async def test_signing_in_opens_a_session_for_the_account(clock: Clock) -> None:
    sign_in = service(clock)
    session = await sign_in.finish(alice())
    signed_in = await sign_in.authenticate(session.token)
    assert signed_in.account == session.account
    assert (signed_in.account.issuer, signed_in.account.subject, signed_in.account.email) == (ISSUER, "alice", "alice@acme.test")
    assert signed_in.csrf == session.csrf and len(session.csrf) >= 32
    assert not signed_in.account.platform_admin


async def test_signing_in_again_is_the_same_account_with_a_new_session(clock: Clock) -> None:
    sign_in = service(clock)
    first, second = await sign_in.finish(alice()), await sign_in.finish(alice("alice@new.test"))
    assert first.account.id == second.account.id and second.account.email == "alice@new.test"
    assert first.token != second.token and first.csrf != second.csrf


async def test_a_session_lasts_twelve_hours(clock: Clock) -> None:
    sign_in = service(clock)
    session = await sign_in.finish(alice())
    clock.now += timedelta(hours=12) - timedelta(seconds=1)
    await sign_in.authenticate(session.token)
    clock.now += timedelta(seconds=1)
    with pytest.raises(SignInRequired):
        await sign_in.authenticate(session.token)


@pytest.mark.parametrize("token", ["", "not-a-session", "x" * 300])
async def test_an_unknown_session_requires_signing_in(clock: Clock, token: str) -> None:
    with pytest.raises(SignInRequired):
        await service(clock).authenticate(token)


async def test_signing_out_ends_the_session(clock: Clock) -> None:
    sign_in = service(clock)
    session = await sign_in.finish(alice())
    await sign_in.sign_out(session.token)
    with pytest.raises(SignInRequired):
        await sign_in.authenticate(session.token)


async def test_an_unverified_email_cannot_sign_in(clock: Clock) -> None:
    with pytest.raises(SignInRefused) as refused:
        await service(clock).finish(alice(verified=False))
    assert refused.value.params == {"reason": "email-not-verified"}


async def test_only_allowed_email_domains_can_sign_in_when_some_are_set(clock: Clock) -> None:
    sign_in = service(clock, allowed_domains=frozenset({"acme.test"}))
    await sign_in.finish(alice("Alice@ACME.test"))
    with pytest.raises(SignInRefused) as refused:
        await sign_in.finish(alice("alice@acme.test.evil.test"))
    assert refused.value.params == {"reason": "domain-not-allowed"}


async def test_the_configured_subject_becomes_platform_administrator(clock: Clock) -> None:
    sign_in = service(clock, platform_admin_subject="alice")
    assert (await sign_in.finish(alice())).account.platform_admin
    assert not (await sign_in.finish(VerifiedIdentity(subject="bob", email="bob@acme.test", email_verified=True))).account.platform_admin


async def test_a_sign_in_flow_resumes_once_within_ten_minutes(clock: Clock) -> None:
    sign_in = service(clock)
    pending = await sign_in.start()
    assert len({pending.token, pending.state, pending.nonce, pending.verifier}) == 4
    flow = await sign_in.resume(pending.token)
    assert (flow.state, flow.nonce, flow.verifier) == (pending.state, pending.nonce, pending.verifier)
    with pytest.raises(SignInFailed):
        await sign_in.resume(pending.token)
    late = await sign_in.start()
    clock.now += timedelta(minutes=10)
    with pytest.raises(SignInFailed):
        await sign_in.resume(late.token)
