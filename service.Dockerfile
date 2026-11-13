# syntax=docker/dockerfile:1
# The Python service (ADR-0009): the HTTP API serving the built React console.
# Build from the repository root: docker build -f service.Dockerfile .
FROM node:24-bookworm-slim AS console
WORKDIR /app
COPY sdk-js/tsconfig.base.json ./sdk-js/tsconfig.base.json
COPY sdk-js/packages/core/ ./sdk-js/packages/core/
COPY console/package*.json ./console/
WORKDIR /app/console
RUN npm ci
COPY console/ ./
RUN ln -s ../console/node_modules /app/sdk-js/node_modules && npm run build

FROM python:3.12-slim-bookworm AS service
COPY --from=ghcr.io/astral-sh/uv:0.11.29 /uv /bin/uv
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy UV_PYTHON_DOWNLOADS=never
WORKDIR /app/sdk-python
COPY sdk-python/ ./
RUN uv sync --locked --no-dev --no-editable --package openentitlement-service

FROM python:3.12-slim-bookworm AS runtime
LABEL org.opencontainers.image.source="https://github.com/open-entitlement/OpenEntitlement" \
      org.opencontainers.image.licenses="Apache-2.0" \
      org.opencontainers.image.description="OpenEntitlement Python service and administration console"
RUN useradd --system --uid 10001 openentitlement
COPY --from=service /app/sdk-python/.venv /app/.venv
COPY --from=console /app/console/web/dist /app/console
COPY LICENSE /app/LICENSE
ENV PATH="/app/.venv/bin:$PATH" OE_HOST=0.0.0.0 PORT=8787 OE_CONSOLE_DIR=/app/console
USER openentitlement
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD python -c "import os, urllib.request; urllib.request.urlopen('http://127.0.0.1:%s/healthz' % os.environ['PORT'])"
CMD ["openentitlement-service"]
