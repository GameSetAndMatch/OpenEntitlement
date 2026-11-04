---
title: Deploy this website
description: Learn about deploy this website in OpenEntitlement.
---

The landing page and documentation are a static Astro/Starlight site. Cloudflare Workers serves the generated assets; it does not run the Node entitlement service.

## Build locally

From the repository root:

```sh
npm ci
npm run check
npm run build
npm run preview
```

`npm run preview` uses Wrangler to serve the production assets. `npm run dev` starts Astro for authoring.

## Cloudflare Git deployment

Connect `GameSetAndMatch/openentitlement` to the Cloudflare Worker named `openentitlement` and use:

| Setting | Value |
|---|---|
| Root directory | Repository root |
| Production branch | `main` |
| Build command | `npm run build` |
| Deploy command | `npx wrangler deploy` |
| Preview command | `npx wrangler versions upload` |

Cloudflare installs dependencies from the root lockfile. Use Node 24 in the build environment. The checked-in `wrangler.jsonc` points at `website/dist`, enables preview URLs, and serves missing routes with a real 404 page.

## Attach the domain

After the first deployment, open the Worker's **Settings → Domains & Routes → Add → Custom Domain** and attach `openentitlement.dev`. Cloudflare manages the DNS record and certificate for a zone in your account.

The domain is intentionally not attached by the source configuration: attaching it is an account-level operation. The canonical site URL and sitemap target `https://openentitlement.dev`.

## Commands and credentials

`npm run deploy` deploys with Wrangler when you are authenticated locally. Do not commit API tokens. Cloudflare's Git integration supplies its own build/deploy credentials.

Documentation includes search, theme switching, a mobile sidebar, generated specification pages, and a downloadable OpenAPI contract. It contains no entitlement service credentials or customer data.
