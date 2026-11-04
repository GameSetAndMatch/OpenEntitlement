/** Execute the shared semantic scenarios across an actual HTTP boundary. */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFileSync, readdirSync } from "node:fs";
import { test } from "node:test";
import { AuditLog, Catalog, createClient, InMemoryProvider, RemoteProvider } from "@openentitlement/core";
import { parse } from "../../sdk-js/conformance/gherkin.ts";
import { runStep, World, type Target, type Seeder } from "../../sdk-js/conformance/steps.ts";
import { createOerep } from "../server/oerep.ts";

const assets = new URL("../../spec/assets/", import.meta.url);
const catalog = Catalog.fromJSON(JSON.parse(readFileSync(new URL("catalog.json", assets), "utf8")));
const plans = JSON.parse(readFileSync(new URL("plans.json", assets), "utf8"));
const scenarios = readdirSync(new URL("gherkin/", assets)).filter((f) => f.endsWith(".feature")).sort().flatMap((f) => parse(new URL(`gherkin/${f}`, assets).pathname));
for (const scenario of scenarios) {
  if (scenario.tags.has("mutations") || scenario.tags.has("fixed")) continue;
  test(`OEREP conformance: ${scenario.id}`, async () => {
    const storage = createClient({ catalog, provider: new InMemoryProvider() });
    const handler = createOerep({ client: storage, catalog, audit: new AuditLog(), close: async () => {} });
    const server = createServer(async (req, res) => { if (!await handler(req, res)) res.writeHead(404).end(); });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const port = (server.address() as { port: number }).port;
    const target: Target = {
      name: "oerep", tags: new Set(["overrides", "grants", "plan-catalog"]),
      async setup(w) {
        w.makeClient(new RemoteProvider({ baseUrl: `http://127.0.0.1:${port}` }));
        const admin = createClient({ catalog, provider: storage.provider, clock: () => w.now });
        // The harness issues administrative steps through the separate server-side admin client.
        Object.defineProperty(w.client!, "admin", { value: admin.admin });
        w.seeder = admin.admin as unknown as Seeder;
      },
      async counter() {
        let n = 0;
        return { async count() { const old = n; await new Promise((r) => setTimeout(r, 2)); return old; }, async increment() { n++; }, async value() { return n; } };
      },
    };
    try {
      const world = new World(target, catalog, plans);
      for (const step of scenario.steps) {
        await runStep(world, step.keyword, step.text);
        if (step.keyword === "Given" && world.error !== undefined) throw world.error;
      }
      assert.ok(world.errorConsumed, `unasserted error: ${String(world.error)}`);
    } finally { await new Promise<void>((r) => server.close(() => r())); }
  });
}
