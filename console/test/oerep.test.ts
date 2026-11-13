import { legacyOerepFetch } from "./legacy-oerep-adapter.ts";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, test } from "node:test";
import { Catalog, createClient, RemoteProvider, Reason, ErrorCode, UNLIMITED, decodeRemoteDetails } from "@openentitlement/core";
import { configFromEnv } from "../server/config.ts";
import { startServer } from "../server/main.ts";

const catalog = Catalog.fromJSON(JSON.parse(readFileSync(new URL("../../spec/assets/catalog.json", import.meta.url), "utf8")));
let service: Awaited<ReturnType<typeof startServer>>;
before(async () => { service = await startServer({ ...configFromEnv(), port: 0, provider: "memory", seedDemo: true, evalToken: "eval-test", adminToken: "admin-test" }); });
after(async () => service?.close());
const client = () => createClient({ catalog, provider: new RemoteProvider({ product: "demo", fetch: legacyOerepFetch, baseUrl: service.url, token: "eval-test" }) });
async function post(path: string, body: unknown, token = "eval-test") {
  return fetch(`${service.url}/oerep/v1/${path}`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
}

test("remote SDK preserves plans, overrides, grants, subject pools, enums and unlimited", async () => {
  const c = client();
  assert.equal(await c.getLimit("seat_max", { organizationId: "hooli" }), 3);
  const override = await c.getDetails("seat_max", { organizationId: "acme" });
  assert.equal(override.value, 250); assert.equal(override.reason, Reason.OVERRIDE); assert.equal(override.planValue, 100);
  const grants = await c.getDetails("api_calls_monthly", { organizationId: "globex", subjectId: "hank" });
  assert.equal(grants.value, 155000); assert.equal(grants.grants.length, 2); assert.equal(grants.reason, Reason.GRANT);
  assert.equal(await c.getLimit("api_calls_monthly", { organizationId: "acme" }), UNLIMITED);
  assert.equal(await c.getEnum("report_retention", { organizationId: "globex" }), "90d");
  assert.equal(await c.isEnabled("sso", { organizationId: "hooli" }), false);
  assert.equal(await c.isEnabled("sso", { organizationId: "acme" }), true);
  await assert.rejects(c.requireWithin("project_max", 1, 1, { organizationId: "hooli" }), (e: any) => e.requiredPlan === "pro");
  assert.equal(await c.requiredPlan("report_retention", "365d", { organizationId: "globex" }), "business");
  const stale = await c.getDetails("project_max", { organizationId: "umbrella" });
  assert.equal(stale.value, 50); assert.equal(stale.staleOverrides.length, 1);
});

test("bulk matches single resolution; caller context time controls expiry", async () => {
  const context = { organizationId: "globex", subjectId: "hank", now: "2026-11-03T12:00:00Z" };
  const bulk = await (await post("resolve", { context })).json() as any;
  assert.equal(bulk.privileges.length, catalog.privileges.length);
  for (const d of bulk.privileges) {
    const single = await (await post(`resolve/${d.privilege}`, { context })).json();
    assert.deepEqual(single, d);
  }
  const admin = await fetch(`${service.url}/api/organizations/hooli/grants`, { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer admin-test" }, body: JSON.stringify({ privilege: "project_max", amount: 2, reason: "dated grant", startsAt: "2026-11-01T00:00:00Z", expiresAt: "2026-11-04T00:00:00Z" }) });
  assert.equal(admin.status, 200);
  const c = client();
  assert.equal(await c.getLimit("project_max", { organizationId: "hooli", now: new Date("2026-11-03T00:00:00Z") }), 3);
  assert.equal(await c.getLimit("project_max", { organizationId: "hooli", now: new Date("2026-11-04T00:00:00Z") }), 1);
});

test("data plane enforces token separation, request validation and method errors", async () => {
  assert.equal((await post("resolve", { context: { organizationId: "hooli" } }, "admin-test")).status, 401);
  assert.equal((await post("resolve", {})).status, 400);
  assert.equal((await post("resolve", { context: { organizationId: 42 } })).status, 400);
  assert.equal((await post("resolve", { context: { organizationId: "hooli", now: "tomorrow" } })).status, 400);
  assert.equal((await post("resolve/unknown", { context: { organizationId: "hooli" } })).status, 404);
  assert.equal((await post("suggest/project_max", { context: { organizationId: "hooli" }, need: -1 })).status, 400);
  assert.equal((await fetch(`${service.url}/oerep/v1/resolve`, { headers: { authorization: "Bearer eval-test" } })).status, 405);
  const admin = await fetch(`${service.url}/api/plans`, { headers: { authorization: "Bearer eval-test" } });
  assert.equal(admin.status, 401);
});

test("auth failures, outages, timeouts and malformed wire metadata fail closed", async () => {
  const badAuth = createClient({ catalog, provider: new RemoteProvider({ product: "demo", fetch: legacyOerepFetch, baseUrl: service.url, token: "wrong" }) });
  assert.equal((await badAuth.getDetails("seat_max", { organizationId: "acme" })).reason, Reason.ERROR);
  const malformed = createClient({ catalog, provider: new RemoteProvider({ product: "demo", baseUrl: service.url, fetch: async () => new Response(JSON.stringify({ privilege: "seat_max", value: 999, reason: "PLAN", grants: [{ id: "g", amount: -10 }], staleOverrides: [] })) }) });
  const d = await malformed.getDetails("seat_max", { organizationId: "acme" });
  assert.equal(d.reason, Reason.ERROR); assert.equal(d.errorCode, ErrorCode.GENERAL); assert.equal(d.requiredPlan, undefined);
  const p = catalog.privilege("seat_max")!;
  assert.throws(() => decodeRemoteDetails({ privilege: "other", value: 10, reason: "PLAN", grants: [], staleOverrides: [] }, p));
  const slow = createClient({ catalog, provider: new RemoteProvider({ product: "demo", baseUrl: service.url, timeoutMs: 1, fetch: async (_url, init) => { await new Promise((resolve) => setTimeout(resolve, 10)); init!.signal!.throwIfAborted(); throw new Error("unreachable"); } }) });
  assert.equal((await slow.getDetails("seat_max", { organizationId: "acme" })).reason, Reason.ERROR);
  const down = createClient({ catalog, provider: new RemoteProvider({ product: "demo", fetch: legacyOerepFetch, baseUrl: "http://127.0.0.1:1" }) });
  assert.equal((await down.getDetails("seat_max", { organizationId: "acme" })).reason, Reason.ERROR);
});

test("Postgres service persists administrative changes across restart", { skip: !process.env.OE_PG_DSN }, async () => {
  const cfg = { ...configFromEnv(), port: 0, provider: "postgres", seedDemo: false, databaseUrl: process.env.OE_PG_DSN, evalToken: "eval-test", adminToken: "admin-test" };
  const org = `remote-${crypto.randomUUID()}`;
  const plan = `plan-${crypto.randomUUID()}`;
  let running = await startServer(cfg);
  const admin = async (path: string, body: unknown) => {
    const r = await fetch(`${running.url}/api/${path}`, { method: "PUT", headers: { "content-type": "application/json", authorization: "Bearer admin-test" }, body: JSON.stringify(body) });
    assert.equal(r.status, 200, await r.text());
  };
  try {
    await admin(`plans/${plan}`, { name: "Persistence test", reason: "test" });
    await admin(`plans/${plan}/values`, { values: { "seat_max": 42 }, reason: "test" });
    await admin(`organizations/${org}/plan`, { planId: plan, reason: "test" });
    await running.close();
    running = await startServer(cfg);
    const c = createClient({ catalog, provider: new RemoteProvider({ product: "demo", fetch: legacyOerepFetch, baseUrl: running.url, token: "eval-test" }) });
    assert.equal(await c.getLimit("seat_max", { organizationId: org }), 42);
  } finally {
    await running.close();
    const { default: pg } = await import("pg");
    const pool = new pg.Pool({ connectionString: process.env.OE_PG_DSN });
    await pool.query("delete from oe_assignment where organization_id = $1", [org]);
    await pool.query("delete from oe_plan_value where plan_id = $1", [plan]);
    await pool.query("delete from oe_plan where id = $1", [plan]);
    await pool.end();
  }
});

test("malformed requests return protocol errors without terminating the service", async () => {
  for (const now of ["2026-02-31T00:00:00Z", "2026-11-03T24:00:00Z", "2026-11-03T12:00:00"]) {
    assert.equal((await post("resolve", { context: { organizationId: "acme", now } })).status, 400);
  }
  const raw = (body: string, type: string) => fetch(`${service.url}/oerep/v1/resolve`, { method: "POST", headers: { authorization: "Bearer eval-test", "content-type": type }, body });
  assert.equal((await raw("{", "application/json")).status, 400);
  assert.equal((await raw("{}", "text/plain")).status, 415);
  assert.equal((await raw(JSON.stringify({ context: { organizationId: "acme" }, padding: "a".repeat(1_000_001) }), "application/json")).status, 413);
  assert.equal((await post("resolve", { context: { organizationId: "acme" } })).status, 200);
});

test("remote quota checks reject grants for another subject and never exceed the resolved value", async () => {
  // A personal grant above the resolved value is consistent once a base may be negative (-90 + 100 = 10),
  // but it still never allows more than the resolved value.
  const personal = createClient({ catalog, provider: new RemoteProvider({ product: "demo", baseUrl: service.url, fetch: async () => new Response(JSON.stringify({ privilege: "seat_max", value: 10, reason: "GRANT", grants: [{ id: "g", amount: 100, subjectId: "alice" }], staleOverrides: [] })) }) });
  await personal.requireWithin("seat_max", 0, 10, { organizationId: "acme", subjectId: "alice" });
  await assert.rejects(personal.requireWithin("seat_max", 0, 11, { organizationId: "acme", subjectId: "alice" }));
  for (const grants of [[{ id: "g", amount: 100, subjectId: "bob" }], [{ id: "g", amount: 5 }, { id: "g", amount: 5 }]]) {
    const c = createClient({ catalog, provider: new RemoteProvider({ product: "demo", baseUrl: service.url, fetch: async () => new Response(JSON.stringify({ privilege: "seat_max", value: 10, reason: "GRANT", grants, staleOverrides: [] })) }) });
    const ctx = { organizationId: "acme", subjectId: "alice" };
    const details = await c.getDetails("seat_max", ctx);
    assert.equal(details.reason, Reason.ERROR);
    await assert.rejects(c.requireWithin("seat_max", 0, 100, ctx));
  }
});
