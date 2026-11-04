---
title: Quickstart
description: Run the reference service and evaluate your first entitlement over HTTP.
---

Run a local service, inspect the demo organizations, and evaluate a real entitlement.

## 1. Start the service

Requires Git, npm, and **Node 24** (Node ≥22.18 also supports the source runner).

```sh
git clone https://github.com/GameSetAndMatch/openentitlement.git
cd openentitlement/console
npm ci
npm run build
npm start
```

Open **http://localhost:8787** for the administrative console. The default backend is in memory and seeds illustrative organizations. Data resets on restart.

## 2. Resolve an entitlement

```sh
curl http://localhost:8787/oerep/v1/resolve/seats.max \
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

Use the [TypeScript](/docs/typescript/) or [Python](/docs/python/) remote provider. The application's catalog must agree with the server's catalog.

For deployments, use the [Postgres hosting guide](/docs/self-hosting/) and configure separate administrative and evaluation credentials. The local demo permits anonymous access by default.
