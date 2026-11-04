# OpenEntitlement website

The public landing page and documentation are a static Astro/Starlight website, deployed separately from the entitlement service.

From the repository root:

```sh
npm ci
npx playwright install chromium
npm run check
npm run build
npm run preview
```

`npm run dev` starts the authoring server. `npm run preview` serves the production build with Wrangler.

The build generates the specification and glossary pages from `spec/sections/` and `GLOSSARY.md`, copies the OpenAPI contract, creates search indexes, checks internal links and anchors, and creates a sitemap. Edit the canonical source documents rather than generated copies.

## Cloudflare Workers Git integration

Use the existing Worker project `openentitlement`:

- Root: repository root
- Production branch: `main`
- Build command: `npx playwright install --with-deps chromium && npm run build`
- Deploy command: `npx wrangler deploy`
- Preview command: `npx wrangler versions upload`
- Build environment: Node 24

The root lockfile installs both the website and Wrangler. `wrangler.jsonc` serves `website/dist` as static assets with proper 404 routing. No backend service, database, API keys, or customer data is deployed.

After the first deployment, attach `openentitlement.dev` in the Worker's Settings → Domains & Routes → Add → Custom Domain. This is an account-level setting and is intentionally not hardcoded into branch previews.

Mermaid fences in the canonical specification render to SVG during documentation preparation. Chromium is a build dependency only; diagram display needs no client JavaScript. CI installs Chromium with its Linux dependencies and runs `npm run test:diagrams --workspace website` against the built pages in both themes and at desktop/mobile widths. Invalid diagram syntax fails the build.
