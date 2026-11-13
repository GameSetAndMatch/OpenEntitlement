"""A fake OpenID Connect issuer for black-box HTTP tests, served through an httpx MockTransport.

It signs real RS256 ID tokens, checks the PKCE verifier and the redirect URI, and can be told to
misbehave (wrong nonce, audience, issuer or key; unverified email; a UserInfo subject mismatch).
"""
from __future__ import annotations

import base64
import hashlib
import secrets
import time
from dataclasses import dataclass, field
from typing import Any
from urllib.parse import parse_qs, urlencode, urlsplit

import httpx
from fastapi.testclient import TestClient
from joserfc import jwt
from joserfc.jwk import RSAKey

ISSUER = "https://id.test"
APP = "https://console.test"
CLIENT_ID = "openentitlement"


def _s256(verifier: str) -> str:
    return base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()


@dataclass
class _Grant:
    subject: str
    nonce: str
    challenge: str
    redirect_uri: str


@dataclass
class FakeIssuer:
    key: RSAKey = field(default_factory=lambda: RSAKey.generate_key(2048, parameters={"kid": "k1"}))
    #: Claims to override in the next ID token, such as ``{"nonce": "other"}``.
    id_token_overrides: dict[str, Any] = field(default_factory=dict)
    #: Sign the next ID token with another key than the published one.
    sign_with_unknown_key: bool = False
    userinfo_overrides: dict[str, Any] = field(default_factory=dict)
    _grants: dict[str, _Grant] = field(default_factory=dict)
    _tokens: dict[str, str] = field(default_factory=dict)

    @property
    def transport(self) -> httpx.MockTransport:
        return httpx.MockTransport(self._handle)

    def authorize(self, location: str, subject: str) -> str:
        """Approve the authorization request at ``location`` as ``subject``; return the callback path."""
        parts = urlsplit(location)
        assert f"{parts.scheme}://{parts.netloc}" == ISSUER and parts.path == "/authorize"
        query = {k: v[0] for k, v in parse_qs(parts.query).items()}
        assert query["response_type"] == "code" and query["client_id"] == CLIENT_ID
        assert query["code_challenge_method"] == "S256"
        assert query["redirect_uri"] == APP + "/auth/callback"
        code = secrets.token_urlsafe(16)
        self._grants[code] = _Grant(subject, query["nonce"], query["code_challenge"], query["redirect_uri"])
        return "/auth/callback?" + urlencode({"code": code, "state": query["state"]})

    def _handle(self, request: httpx.Request) -> httpx.Response:
        path = request.url.path
        if path == "/.well-known/openid-configuration":
            return httpx.Response(200, json={
                "issuer": ISSUER,
                "authorization_endpoint": ISSUER + "/authorize",
                "token_endpoint": ISSUER + "/token",
                "userinfo_endpoint": ISSUER + "/userinfo",
                "jwks_uri": ISSUER + "/jwks",
                "id_token_signing_alg_values_supported": ["RS256"],
            })
        if path == "/jwks":
            return httpx.Response(200, json={"keys": [self.key.as_dict(private=False)]})
        if path == "/token":
            form = {k: v[0] for k, v in parse_qs(request.content.decode()).items()}
            grant = self._grants.pop(form.get("code", ""), None)
            if (
                grant is None
                or form.get("grant_type") != "authorization_code"
                or form.get("client_id") != CLIENT_ID
                or form.get("redirect_uri") != grant.redirect_uri
                or _s256(form.get("code_verifier", "")) != grant.challenge
            ):
                return httpx.Response(400, json={"error": "invalid_grant"})
            access = secrets.token_urlsafe(16)
            self._tokens[access] = grant.subject
            now = int(time.time())
            claims = {"iss": ISSUER, "sub": grant.subject, "aud": CLIENT_ID, "iat": now, "exp": now + 300, "nonce": grant.nonce}
            claims.update(self.id_token_overrides)
            key = RSAKey.generate_key(2048, parameters={"kid": "k1"}) if self.sign_with_unknown_key else self.key
            id_token = jwt.encode({"alg": "RS256", "kid": "k1"}, claims, key)
            return httpx.Response(200, json={"access_token": access, "id_token": id_token, "token_type": "Bearer"})
        if path == "/userinfo":
            subject = self._tokens.get(request.headers.get("authorization", "").removeprefix("Bearer "))
            if subject is None:
                return httpx.Response(401)
            info = {"sub": subject, "email": f"{subject}@acme.test", "email_verified": True}
            return httpx.Response(200, json=info | self.userinfo_overrides)
        return httpx.Response(404)


def sign_in(client: TestClient, issuer: FakeIssuer, subject: str) -> dict[str, str]:
    """Sign ``client`` in as ``subject``; return the headers a state-changing request needs."""
    login = client.get("/auth/login", follow_redirects=False)
    assert login.status_code == 302, login.text
    finished = client.get(issuer.authorize(login.headers["location"], subject), follow_redirects=False)
    assert finished.status_code == 302, finished.text
    return {"origin": APP, "x-oe-csrf": client.get("/api/session").json()["csrf"]}
