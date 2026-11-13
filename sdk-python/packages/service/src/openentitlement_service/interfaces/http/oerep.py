"""OEREP 0.1 on HTTP (spec §10, RFC-0005): an application evaluates its Product with an API key.

The order of checks is the service layer's (401, then 403, then 404); this module only reads the
request. The body is read before the key is checked but judged after it, so a request with a bad
key gets 401 whatever its body, and one for another Product gets 403 whatever it asks.
"""
from __future__ import annotations

import json
from typing import Any

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from ...services.evaluation import EvaluationService
from ...services.problems import FieldError, RequestTooLarge, UnsupportedMediaType, ValidationFailed

router = APIRouter(prefix="/oerep/v1/products/{product}/privileges", tags=["oerep"])

#: The reference body limit (Requirement 10.1.2).
MAX_BODY = 1_000_000
NO_STORE = {"Cache-Control": "no-store"}


class _Body:
    """The request body as read, judged only once the key and Product were accepted."""

    def __init__(self, request: Request, raw: bytes, too_large: bool) -> None:
        self.content_type = request.headers.get("content-type", "")
        self.raw, self.too_large = raw, too_large

    def json(self) -> Any:
        media = self.content_type.split(";", 1)[0].strip().lower()
        if media != "application/json":
            raise UnsupportedMediaType(accepted="application/json")
        if self.too_large:
            raise RequestTooLarge(limit=MAX_BODY)
        try:
            return json.loads(self.raw)
        except (ValueError, UnicodeDecodeError):
            raise ValidationFailed([FieldError("", "Send valid JSON.")]) from None


async def _read(request: Request) -> _Body:
    chunks, size = [], 0
    async for chunk in request.stream():
        size += len(chunk)
        if size > MAX_BODY:
            return _Body(request, b"", True)
        chunks.append(chunk)
    return _Body(request, b"".join(chunks), False)


def _service(request: Request) -> EvaluationService:
    service: EvaluationService = request.app.state.evaluation
    return service


def _ok(data: Any) -> JSONResponse:
    return JSONResponse(data, headers=NO_STORE)


@router.post("/resolve", summary="Resolve every Privilege of the Product")
async def resolve_all(request: Request, product: str) -> JSONResponse:
    """`{privileges: ResolutionDetails[]}`, one result per Privilege of the Product, at one evaluation time."""
    body = await _read(request)
    async with _service(request).open(request.headers.get("authorization"), product) as evaluation:
        details = await evaluation.resolve(evaluation.privileges, body.json())
        return _ok({"privileges": [d.to_dict() for d in details]})


@router.post("/{privilege}/resolve", summary="Resolve one Privilege")
async def resolve(request: Request, product: str, privilege: str) -> JSONResponse:
    body = await _read(request)
    async with _service(request).open(request.headers.get("authorization"), product) as evaluation:
        found = evaluation.privilege(privilege)
        [details] = await evaluation.resolve((found,), body.json())
        return _ok(details.to_dict())


@router.post("/{privilege}/upgrade", summary="The lowest-ranked Tier that meets a need")
async def upgrade(request: Request, product: str, privilege: str) -> JSONResponse:
    """`{requiredPlan}`: a Tier of this Product (§3.4), or null when evaluation fails or none qualifies."""
    body = await _read(request)
    async with _service(request).open(request.headers.get("authorization"), product) as evaluation:
        found = evaluation.privilege(privilege)
        return _ok({"requiredPlan": await evaluation.upgrade(found, body.json())})
