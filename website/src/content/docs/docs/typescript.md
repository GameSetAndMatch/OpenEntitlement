---
title: TypeScript SDK
description: Connect a TypeScript application to an OEREP service with the reference SDK.
---

The core SDK uses the platform `fetch` API. Its one runtime dependency is [Zod](https://zod.dev), which validates Privilege Catalogs in `@openentitlement/core/authoring`; `npm install @openentitlement/core` installs it. Start from a source checkout; package publication is not assumed here.

## Use the repository workspace

From the repo root:

```sh
cd sdk-js
npm ci
```

Save the example below as `sdk-js/example.ts`, and run it with `node --conditions=source example.ts`. Start the [demo server](/docs/quickstart/) first.

```ts
import { readFileSync } from 'node:fs';
import { Catalog, createClient, RemoteProvider } from '@openentitlement/core';

const catalog = Catalog.fromJSON(JSON.parse(
  readFileSync(new URL('../spec/assets/catalog.json', import.meta.url), 'utf8')
));
const client = createClient({
  catalog,
  provider: new RemoteProvider({
    baseUrl: 'http://localhost:8787',
    token: process.env.OE_EVAL_TOKEN,
    timeoutMs: 5000,
  }),
});

const context = { organizationId: 'acme' };
console.log(await client.getLimit('seat_max', context)); // 250
console.log(await client.isEnabled('sso', context));      // true
console.log(await client.getDetails('seat_max', context));
```

## Gate a request

`isEnabled` checks a feature's gate privilege. `getLimit` returns an integer or `UNLIMITED`. `getEnum` returns a declared option. `getDetails` returns the explanation.

```ts
await client.requireWithin('project_max', 4, 1, { organizationId: 'globex' });
// Current 4 + requested 1 fits Pro's limit of 5.
```

`requireWithin` checks only; use [guard](/docs/guards/) when counting usage and acting must be serialized. Map an `EntitlementDenied` error with `toHttpProblem` for an RFC 9457-style 403 response.

## Validate a Privilege Catalog

```ts
import { parseCatalog } from '@openentitlement/core/authoring';

const catalog = parseCatalog({
  groups: [{ id: 'collaboration', title: 'Collaboration' }],
  privileges: [{ key: 'seat_max', type: 'integer', title: 'Seats', default: 5, groupId: 'collaboration' }],
});
```

`parseCatalog` and `parsePrivilege` throw an `Error` listing every problem; `PrivilegeCatalogSchema` and `PrivilegeSchema` are the underlying Zod schemas for `safeParse` or form libraries. Keys are camelCase (`groupId`, `parentId`, `envOverride`). The same rules are published as a [JSON Schema](/docs/privilege-catalog/#shared-json-schema).

The remote provider never caches decisions. Timeouts, HTTP failures, malformed responses, and catalog mismatches become evaluation errors using the local default. Evaluation tokens are backend credentials; do not put them in a browser bundle.

[Full SDK source and examples](https://github.com/open-entitlement/OpenEntitlement/tree/main/sdk-js).
