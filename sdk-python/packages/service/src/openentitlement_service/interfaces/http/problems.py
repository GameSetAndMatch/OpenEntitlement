"""The one exception handler: every error leaves the service as RFC 9457 Problem Details."""
from __future__ import annotations

import logging
from http import HTTPStatus
from collections.abc import Mapping
from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException

from ...services.problems import (
    ProductForbidden,
    FieldError,
    InternalError,
    MethodNotAllowed,
    NotFound,
    Problem,
    ValidationFailed,
    escape_pointer_token,
    input_pointer,
)

PROBLEM_JSON = "application/problem+json"
logger = logging.getLogger("openentitlement_service")


def _pointer(error: Mapping[str, Any], body: Any) -> str:
    """A JSON Pointer (RFC 6901) for a FastAPI error location such as ("body", "tiers", 0, "name").

    Body fields point into the body; other locations start with their name ("/query/limit").
    Unparseable JSON points at the whole body ("").
    """
    if error.get("type") == "json_invalid":
        return ""
    where, *path = tuple(error["loc"])
    if where == "body":
        # Union members and discriminator branches are not request locations.
        return input_pointer(path, body, error.get("type", ""), error.get("ctx"))
    return "/" + str(where) + "".join("/" + escape_pointer_token(t) for t in path)


def as_problem(request: Request, exc: Exception) -> Problem | HTTPException:
    """Translate any exception into a typed problem. Unknown exceptions become ``internal-error``.

    An HTTP error from the framework that no problem type describes is returned as is.
    """
    if isinstance(exc, Problem):
        return exc
    if isinstance(exc, RequestValidationError):
        return ValidationFailed([FieldError(_pointer(e, exc.body), e["msg"]) for e in exc.errors()])
    if isinstance(exc, HTTPException):
        if exc.status_code == 404:
            return NotFound()
        if exc.status_code == 405:
            allowed = (exc.headers or {}).get("Allow", "")
            return MethodNotAllowed(request.method, [m.strip() for m in allowed.split(",") if m.strip()])
        return exc
    logger.exception("Unexpected error on %s %s", request.method, request.url.path, exc_info=exc)
    return InternalError()


async def problem_handler(request: Request, exc: Exception) -> JSONResponse:
    problem = as_problem(request, exc)
    if isinstance(problem, HTTPException):
        # Another HTTP error raised by the framework itself: RFC 9457's untyped problem.
        status = problem.status_code
        plain = {"type": "about:blank", "title": HTTPStatus(status).phrase, "status": status, "instance": request.url.path}
        return JSONResponse(plain, status_code=status, media_type=PROBLEM_JSON, headers=problem.headers)
    body: dict[str, Any] = {
        "type": problem.type,
        "title": problem.title,
        "status": problem.status,
        "detail": problem.detail,
        "instance": "/oerep/v1" if isinstance(problem, ProductForbidden) else request.url.path,
        **problem.params,
    }
    headers = dict(problem.headers or {})
    if request.url.path.startswith("/oerep/"):
        headers["Cache-Control"] = "no-store"
    return JSONResponse(body, status_code=problem.status, media_type=PROBLEM_JSON, headers=headers)


def install(app: FastAPI) -> None:
    """Register the single handler for every exception the app can raise."""
    for exc_class in (Exception, HTTPException, RequestValidationError, Problem):
        app.add_exception_handler(exc_class, problem_handler)
