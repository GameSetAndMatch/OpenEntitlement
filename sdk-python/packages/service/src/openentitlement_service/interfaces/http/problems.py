"""The one exception handler: every error leaves the service as RFC 9457 Problem Details."""
from __future__ import annotations

import logging
from collections.abc import Mapping
from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException

from ...services.problems import (
    FieldError,
    InternalError,
    MethodNotAllowed,
    NotFound,
    Problem,
    ValidationFailed,
)

PROBLEM_JSON = "application/problem+json"
logger = logging.getLogger("openentitlement_service")


def _pointer(error: Mapping[str, Any]) -> str:
    """A JSON Pointer (RFC 6901) for a FastAPI error location such as ("body", "tiers", 0, "name").

    Body fields point into the body; other locations start with their name ("/query/limit").
    Unparseable JSON points at the whole body ("").
    """
    if error.get("type") == "json_invalid":
        return ""
    where, *path = tuple(error["loc"])
    tokens = [str(t).replace("~", "~0").replace("/", "~1") for t in path]
    prefix = "" if where == "body" else "/" + str(where)
    return prefix + "".join("/" + t for t in tokens)


def as_problem(request: Request, exc: Exception) -> Problem:
    """Translate any exception into a typed problem. Unknown exceptions become ``internal-error``."""
    if isinstance(exc, Problem):
        return exc
    if isinstance(exc, RequestValidationError):
        return ValidationFailed([FieldError(_pointer(e), e["msg"]) for e in exc.errors()])
    if isinstance(exc, HTTPException):
        if exc.status_code == 404:
            return NotFound()
        if exc.status_code == 405:
            allowed = (exc.headers or {}).get("Allow", "")
            return MethodNotAllowed(request.method, [m.strip() for m in allowed.split(",") if m.strip()])
    logger.exception("Unexpected error on %s %s", request.method, request.url.path, exc_info=exc)
    return InternalError()


async def problem_handler(request: Request, exc: Exception) -> JSONResponse:
    problem = as_problem(request, exc)
    body: dict[str, Any] = {
        "type": problem.type,
        "title": problem.title,
        "status": problem.status,
        "detail": problem.detail,
        "instance": request.url.path,
        **problem.params,
    }
    headers = {"Allow": ", ".join(problem.params["allowed"])} if isinstance(problem, MethodNotAllowed) else None
    return JSONResponse(body, status_code=problem.status, media_type=PROBLEM_JSON, headers=headers)


def install(app: FastAPI) -> None:
    """Register the single handler for every exception the app can raise."""
    for exc_class in (Exception, HTTPException, RequestValidationError, Problem):
        app.add_exception_handler(exc_class, problem_handler)
