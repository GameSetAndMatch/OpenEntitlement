---
title: Quickstart
description: Run the reference service and evaluate your first entitlement over HTTP.
---

Run a local service, inspect the demo organizations, and evaluate a real entitlement.

## 1. Start the service

This walkthrough uses the current source Catalog (`seat_max`, `project_max`, and other flat keys). Until a Docker release containing these keys is published, build the image from this checkout; older published images retain their previous Catalog keys:

```sh
git clone https://github.com/open-entitlement/OpenEntitlement.git
cd OpenEntitlement
docker build -t openentitlement:local .
docker run --rm -p 127.0.0.1:8787:8787 -e OE_SEED=demo openentitlement:local
```

Or, from source (requires Git, npm, and **Node 24**; Node ≥22.18 also supports the source runner):

```sh
git clone https://github.com/open-entitlement/OpenEntitlement.git
cd openentitlement/console
npm ci
npm run build
OE_SEED=demo npm start
```

Open **http://localhost:8787** for the administrative console. The memory backend resets on restart. Without `OE_SEED=demo`, a new instance starts empty and the console opens a setup screen instead.

## 2. Resolve an entitlement

```sh
curl http://localhost:8787/oerep/v1/resolve/seat_max \
  -H 'Content-Type: application/json' \
  -d '{"context":{"organizationId":"acme"}}'
```

The response includes `value: 250`, `reason: "OVERRIDE"`, `planId: "business"`, and `planValue: 100`. The generated `overrideId` varies per run.

Acme's negotiated 250 seats replace the Business default of 100. Its API quota is unlimited, encoded as `{"unlimited":true}`.

## 3. Compare customers

| Demo organization | Example |
|---|---|
| `hooli` | Free: 3 seats, 1 project, SSO disabled |
| `globex` | Pro: 20 seats, 5 projects, plus 50,000 API calls from a grant |
| `initech` | Trial variant: 8 projects through an override |
| `acme` | Business: 250 negotiated seats and unlimited API calls |
| `umbrella` | Downgraded to Business: its old Enterprise override is visible but stale |

In the console, choose Hooli, set current project usage to 1, and request another project. The check is denied with an upgrade suggestion. Choose Acme to see the same request fit a different limit.

## 4. Connect your application

Use the [Python](/docs/python/) or [TypeScript](/docs/typescript/) remote provider. The application's catalog must agree with the server's catalog.

For deployments, use the [Postgres hosting guide](/docs/self-hosting/) and configure separate administrative and evaluation credentials. The local demo permits anonymous access by default.
