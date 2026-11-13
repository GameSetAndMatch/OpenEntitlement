---
title: Quickstart
description: Run the reference service from source and ask it for your first entitlement, over HTTP and from the TypeScript SDK.
---

Run the reference service on your machine, ask it how many seats two demo customers have, and get the same answer from the TypeScript SDK.

You need Git and Node 24 (Node 22.18 or later also works) in a macOS or Linux shell. It takes about five minutes. Everything runs from a source checkout, so it matches the current code.

## 1. Start the service

```sh
git clone --depth 1 https://github.com/open-entitlement/OpenEntitlement.git
cd OpenEntitlement/console
npm ci --prefix ../sdk-js
npm ci
npm run build
OE_SEED=demo npm start
```

The last command prints `OpenEntitlement Console on http://localhost:8787 (provider: memory)` and keeps running. Leave it open.

`OE_SEED=demo` loads five demo Organizations, such as Hooli on the Free Tier and Acme on Business. The memory backend forgets every change when the service stops.

## 2. Ask over HTTP

In a second terminal, ask how many seats Acme has:

```sh
curl http://localhost:8787/oerep/v1/resolve/seat_max \
  -H 'Content-Type: application/json' \
  -d '{"context":{"organizationId":"acme"}}'
```

```json title="Response"
{"privilege":"seat_max","value":250,"reason":"OVERRIDE","grants":[],"staleOverrides":[],"planId":"business","planValue":100,"overrideId":"ovr_596b7013809c468a"}
```

The `overrideId` is different on every start. Acme has 250 seats because a negotiated override replaces the Business default of 100. `reason` and `planValue` say where the value came from.

## 3. Ask from the SDK

In the second terminal, from the directory where you cloned the repository, write a small script and run it:

```sh
cd OpenEntitlement/sdk-js
cat > quickstart.ts <<'EOF'
import { readFileSync } from 'node:fs';
import { Catalog, createClient, RemoteProvider } from '@openentitlement/core';

const catalog = Catalog.fromJSON(JSON.parse(readFileSync('../spec/assets/catalog.json', 'utf8')));
const client = createClient({ catalog, provider: new RemoteProvider({ baseUrl: 'http://localhost:8787' }) });

for (const organizationId of ['hooli', 'acme']) {
  const details = await client.getDetails('seat_max', { organizationId });
  console.log(organizationId, details.value, details.reason);
}
EOF
node --conditions=source quickstart.ts
```

You should see exactly:

```text title="Expected output"
hooli 3 PLAN
acme 250 OVERRIDE
```

Hooli gets the Free Tier's 3 seats (`PLAN`). Acme gets its negotiated 250 (`OVERRIDE`). Your application asks the same question and gets the value with its reason.

## Next

- Open **http://localhost:8787** to see the same Organizations in the console. Choose Hooli, set current project usage to 1 and request another project: the check is denied with an upgrade suggestion.
- Gate requests with the [TypeScript SDK](/docs/typescript/) or the [Python SDK](/docs/python/), and count usage with [guards](/docs/guards/).
- Run the service with Docker Compose and Postgres, with separate administration and evaluation credentials: [Self-host the service](/docs/self-hosting/). The local demo allows anonymous access.
