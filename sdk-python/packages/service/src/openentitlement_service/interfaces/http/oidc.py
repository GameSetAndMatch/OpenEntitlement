"""The console's OpenID Connect client: authorization code flow with PKCE (S256), state and nonce.

It discovers the issuer once, verifies the ID token's signature against the issuer's keys and its
claims (issuer, audience, expiry, nonce, access-token hash) with Authlib's OIDC rules, then reads
the email from the UserInfo endpoint, whose subject must match the ID token's. Any failure of the
exchange is ``sign-in-failed``; the sign-in rules themselves live in the service layer.
"""
from __future__ import annotations

import base64
import hashlib
import logging
from dataclasses import dataclass, field
from typing import Any
from urllib.parse import urlencode, urlsplit

import httpx
from authlib.oidc.core import CodeIDToken
from joserfc import jwt
from joserfc.errors import JoseError
from joserfc.jwk import KeySet

from ...services.models import SignInFlow
from ...services.problems import SignInFailed
from ...services.sign_in import PendingSignIn, VerifiedIdentity

logger = logging.getLogger("openentitlement_service")

#: ID tokens must be signed with an asymmetric algorithm the issuer publishes keys for.
ASYMMETRIC_ALGORITHMS = ("RS256", "RS384", "RS512", "PS256", "PS384", "PS512", "ES256", "ES384", "ES512", "EdDSA")
LOOPBACK = {"localhost", "127.0.0.1", "[::1]", "::1"}
CLOCK_LEEWAY_SECONDS = 60


def origin_of(url: str, *, allow_local_http: bool, what: str) -> str:
    """An HTTPS origin (or loopback HTTP when allowed), without a trailing slash."""
    parts = urlsplit(url)
    local = allow_local_http and parts.scheme == "http" and parts.hostname in LOOPBACK
    if parts.scheme != "https" and not local:
        raise ValueError(f"{what} requires HTTPS; plain HTTP is allowed only on loopback with OE_OIDC_LOCAL_HTTP=true")
    if parts.username or parts.password or parts.query or parts.fragment:
        raise ValueError(f"{what} cannot contain credentials, a query or a fragment")
    return url.rstrip("/")


@dataclass(frozen=True)
class OidcSettings:
    #: The console's own origin, for example ``https://console.example.com``. Sign-in returns to ``/auth/callback``.
    app_url: str
    issuer: str
    client_id: str
    client_secret: str | None = field(default=None, repr=False)
    allow_local_http: bool = False

    def __post_init__(self) -> None:
        app = origin_of(self.app_url, allow_local_http=self.allow_local_http, what="OE_APP_URL")
        if urlsplit(app).path:
            raise ValueError("OE_APP_URL must be an origin without a path")
        object.__setattr__(self, "app_url", app)
        object.__setattr__(self, "issuer", origin_of(self.issuer, allow_local_http=self.allow_local_http, what="OE_OIDC_ISSUER"))

    @property
    def redirect_uri(self) -> str:
        return self.app_url + "/auth/callback"

    @property
    def secure_cookies(self) -> bool:
        return self.app_url.startswith("https:")


def s256(verifier: str) -> str:
    return base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()


class OidcClient:
    def __init__(self, settings: OidcSettings, *, transport: httpx.AsyncBaseTransport | None = None) -> None:
        self.settings = settings
        self._transport = transport
        self._metadata: dict[str, Any] | None = None

    def _http(self) -> httpx.AsyncClient:
        return httpx.AsyncClient(transport=self._transport, timeout=10.0, follow_redirects=False)

    async def _discover(self) -> dict[str, Any]:
        if self._metadata is None:
            async with self._http() as http:
                response = await http.get(self.settings.issuer + "/.well-known/openid-configuration")
                response.raise_for_status()
                metadata = response.json()
            if str(metadata.get("issuer", "")).rstrip("/") != self.settings.issuer:
                raise SignInFailed("The sign-in provider is misconfigured.")
            self._metadata = metadata
        return self._metadata

    async def authorization_url(self, pending: PendingSignIn) -> str:
        try:
            metadata = await self._discover()
        except (httpx.HTTPError, ValueError) as exc:
            logger.warning("OIDC discovery failed: %s", type(exc).__name__)
            raise SignInFailed("The sign-in provider cannot be reached. Try again later.") from exc
        query = {
            "response_type": "code",
            "client_id": self.settings.client_id,
            "redirect_uri": self.settings.redirect_uri,
            "scope": "openid email profile",
            "state": pending.state,
            "nonce": pending.nonce,
            "code_challenge": s256(pending.verifier),
            "code_challenge_method": "S256",
        }
        return f"{metadata['authorization_endpoint']}?{urlencode(query)}"

    async def identify(self, flow: SignInFlow, *, code: str) -> VerifiedIdentity:
        """Exchange the authorization code and return the verified identity, or ``sign-in-failed``."""
        try:
            return await self._identify(flow, code)
        except SignInFailed:
            raise
        except (httpx.HTTPError, JoseError, ValueError, KeyError, TypeError) as exc:
            logger.warning("OIDC sign-in failed: %s", type(exc).__name__)
            raise SignInFailed() from exc

    async def _identify(self, flow: SignInFlow, code: str) -> VerifiedIdentity:
        metadata = await self._discover()
        form = {
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": self.settings.redirect_uri,
            "code_verifier": flow.verifier,
        }
        auth: tuple[str, str] | None = None
        if self.settings.client_secret:
            auth = (self.settings.client_id, self.settings.client_secret)
        else:
            form["client_id"] = self.settings.client_id
        async with self._http() as http:
            token_response = await http.post(metadata["token_endpoint"], data=form, auth=auth or httpx.USE_CLIENT_DEFAULT)
            token_response.raise_for_status()
            tokens = token_response.json()
            access_token, id_token = str(tokens["access_token"]), str(tokens["id_token"])
            jwks = (await http.get(metadata["jwks_uri"])).raise_for_status().json()
            published = metadata.get("id_token_signing_alg_values_supported") or ["RS256"]
            algorithms = [a for a in published if a in ASYMMETRIC_ALGORITHMS]
            token = jwt.decode(id_token, KeySet.import_key_set(jwks), algorithms=algorithms)
            claims = CodeIDToken(
                token.claims,
                token.header,
                {"iss": {"essential": True, "value": self.settings.issuer}, "aud": {"essential": True, "value": self.settings.client_id}},
                {"nonce": flow.nonce, "client_id": self.settings.client_id, "access_token": access_token},
            )
            claims.validate(leeway=CLOCK_LEEWAY_SECONDS)
            userinfo_response = await http.get(
                metadata["userinfo_endpoint"], headers={"Authorization": f"Bearer {access_token}"}
            )
            userinfo = userinfo_response.raise_for_status().json()
        subject = claims["sub"]
        if not isinstance(subject, str) or userinfo.get("sub") != subject:
            raise SignInFailed()
        email = userinfo.get("email")
        return VerifiedIdentity(
            subject=subject,
            email=email if isinstance(email, str) else "",
            email_verified=isinstance(email, str) and userinfo.get("email_verified") is True,
        )
