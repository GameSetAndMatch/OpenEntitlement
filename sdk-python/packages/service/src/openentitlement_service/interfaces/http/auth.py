"""Console sign-in over OIDC, the session cookie and CSRF protection.

``/auth/login`` starts the authorization code flow, ``/auth/callback`` finishes it and sets the
``oe_session`` cookie (HttpOnly, SameSite=Lax, Secure over HTTPS, 12 hours), and ``/auth/logout``
ends the session. Every API request needs the session; a request that changes state also needs
this console's ``Origin`` and the session's CSRF token in ``X-OE-CSRF`` (given by ``/api/session``).
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from hmac import compare_digest
from typing import Annotated

from fastapi import APIRouter, Depends, Request, Response
from fastapi.responses import RedirectResponse

from ...services.problems import CsrfRejected, ServiceUnavailable, SignInFailed, SignInRequired
from ...services.sign_in import SignedIn, SignInPolicy, SignInService
from .oidc import OidcClient, OidcSettings

SESSION_COOKIE = "oe_session"
FLOW_COOKIE = "oe_flow"
SESSION_SECONDS = 12 * 60 * 60
FLOW_SECONDS = 10 * 60
#: Cookie values the service issues; anything else is ignored.
COOKIE_VALUE = re.compile(r"^[A-Za-z0-9_-]{1,200}$")
SAFE_METHODS = frozenset({"GET", "HEAD", "OPTIONS"})
NO_STORE = {"Cache-Control": "no-store"}


@dataclass(frozen=True)
class SignInSettings:
    oidc: OidcSettings
    #: The OIDC subject that becomes a Platform administrator (``OE_PLATFORM_ADMIN_SUBJECT``).
    platform_admin_subject: str | None = None
    #: Email domains allowed to sign in (``OE_SIGNUP_DOMAINS``); empty allows every domain.
    allowed_domains: frozenset[str] = field(default_factory=frozenset)

    def policy(self) -> SignInPolicy:
        return SignInPolicy(
            issuer=self.oidc.issuer,
            platform_admin_subject=self.platform_admin_subject,
            allowed_domains=frozenset(d.lower() for d in self.allowed_domains),
        )


@dataclass(frozen=True)
class Authentication:
    service: SignInService
    #: ``None`` when sign-in is not configured: nobody can sign in.
    oidc: OidcClient | None


def _authentication(request: Request) -> Authentication:
    authentication: Authentication = request.app.state.authentication
    return authentication


def _configured(request: Request) -> tuple[SignInService, OidcClient]:
    authentication = _authentication(request)
    if authentication.oidc is None:
        raise ServiceUnavailable("Sign-in is not configured on this service.")
    return authentication.service, authentication.oidc


def cookie(request: Request, name: str) -> str:
    value = request.cookies.get(name, "")
    return value if COOKIE_VALUE.fullmatch(value) else ""


def _set_cookie(response: Response, oidc: OidcClient, name: str, value: str, max_age: int) -> None:
    response.set_cookie(
        name, value, max_age=max_age, path="/", httponly=True, samesite="lax", secure=oidc.settings.secure_cookies
    )


async def signed_in(request: Request) -> SignedIn:
    """The signed-in Account. A state-changing request must also pass the CSRF check."""
    authentication = _authentication(request)
    if authentication.oidc is None:
        raise SignInRequired()
    signed = await authentication.service.authenticate(cookie(request, SESSION_COOKIE))
    if request.method not in SAFE_METHODS:
        origin = request.headers.get("origin", "")
        token = request.headers.get("x-oe-csrf", "")
        if not (compare_digest(origin, authentication.oidc.settings.app_url) and compare_digest(token, signed.csrf)):
            raise CsrfRejected()
    return signed


#: The signed-in Account of the request, after the CSRF check for state-changing methods.
CurrentAccount = Annotated[SignedIn, Depends(signed_in)]

router = APIRouter()


@router.get("/auth/login", include_in_schema=False)
async def login(request: Request) -> RedirectResponse:
    service, oidc = _configured(request)
    pending = await service.start()
    response = RedirectResponse(await oidc.authorization_url(pending), status_code=302, headers=NO_STORE)
    _set_cookie(response, oidc, FLOW_COOKIE, pending.token, FLOW_SECONDS)
    return response


@router.get("/auth/callback", include_in_schema=False)
async def callback(
    request: Request, code: str | None = None, state: str | None = None, error: str | None = None
) -> RedirectResponse:
    service, oidc = _configured(request)
    # The flow is used once, even when this attempt fails.
    flow = await service.resume(cookie(request, FLOW_COOKIE))
    if error or not code or not state or not compare_digest(state, flow.state):
        raise SignInFailed()
    session = await service.finish(await oidc.identify(flow, code=code))
    response = RedirectResponse("/app/", status_code=302, headers=NO_STORE)
    _set_cookie(response, oidc, SESSION_COOKIE, session.token, SESSION_SECONDS)
    _set_cookie(response, oidc, FLOW_COOKIE, "", 0)
    return response


@router.post("/auth/logout", status_code=204, include_in_schema=False)
async def logout(request: Request, signed: CurrentAccount) -> Response:
    service, oidc = _configured(request)
    await service.sign_out(cookie(request, SESSION_COOKIE))
    response = Response(status_code=204, headers=NO_STORE)
    _set_cookie(response, oidc, SESSION_COOKIE, "", 0)
    return response


@router.get("/api/session", tags=["session"])
async def session(signed: CurrentAccount, response: Response) -> dict[str, object]:
    """The signed-in Account and the CSRF token to send in ``X-OE-CSRF`` with every change."""
    response.headers.update(NO_STORE)
    account = signed.account
    return {
        "account": {"id": str(account.id), "email": account.email, "platformAdmin": account.platform_admin},
        "csrf": signed.csrf,
    }
