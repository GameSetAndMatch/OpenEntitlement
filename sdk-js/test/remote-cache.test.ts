import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { Catalog, createClient, EntitlementLimitExceeded, InMemoryProvider, Reason, RemoteProvider, type RemoteProviderOptions } from "@openentitlement/core";

const catalog = Catalog.fromJSON(JSON.parse(readFileSync(new URL("../../spec/assets/catalog.json", import.meta.url), "utf8")));

/** A fake OEREP server behind `fetch` that records every request. */
function fakeServer() {
  const state = {
    requests: [] as { path: string; body: any }[],
    fail: false,
    values: { seat_max: 10 as unknown, project_max: 5, api_calls_monthly: 100, sso_enabled: true, sso_connection_max: 1, reports_enabled: true, report_retention: "90d" } as Record<string, unknown>,
  };
  const details = (privilege: string) => ({ privilege, value: state.values[privilege], reason: "PLAN", planId: "pro", grants: [], staleOverrides: [] });
  const fetch: typeof globalThis.fetch = async (url, init) => {
    const path = new URL(String(url)).pathname;
    state.requests.push({ path, body: JSON.parse(String(init!.body)) });
    if (state.fail) return new Response(JSON.stringify({ error: "internal", message: "down" }), { status: 500 });
    if (path === "/oerep/v1/resolve") return Response.json({ privileges: Object.keys(state.values).map(details) });
    if (path.startsWith("/oerep/v1/suggest/")) return Response.json({ requiredPlan: "pro" });
    return Response.json(details(decodeURIComponent(path.split("/").at(-1)!)));
  };
  return { state, fetch };
}

function cached(extra: Partial<RemoteProviderOptions> = {}) {
  const server = fakeServer();
  const clock = { t: 0 };
  const provider = new RemoteProvider({ baseUrl: "http://oerep.test", fetch: server.fetch, cacheTtlMs: 10_000, monotonicClock: () => clock.t, ...extra });
  return { ...server, clock, provider, client: createClient({ catalog, provider }) };
}

const acme = { organizationId: "acme" };

describe("RemoteProvider opt-in decision cache", () => {
  it("is off by default", async () => {
    const { state, fetch } = fakeServer();
    const c = createClient({ catalog, provider: new RemoteProvider({ baseUrl: "http://oerep.test", fetch }) });
    for (let i = 0; i < 3; i++) assert.equal(await c.getLimit("seat_max", acme), 10);
    assert.equal(state.requests.length, 3);
  });

  it("serves hits within the TTL and refetches after expiry", async () => {
    const { state, clock, client } = cached();
    for (let i = 0; i < 3; i++) assert.equal(await client.getLimit("seat_max", acme), 10);
    assert.equal(state.requests.length, 1);
    state.values.seat_max = 20;
    clock.t = 9_999;
    assert.equal(await client.getLimit("seat_max", acme), 10); // up to TTL stale
    clock.t = 10_000;
    assert.equal(await client.getLimit("seat_max", acme), 20);
    assert.equal(state.requests.length, 2);
  });

  it("keeps separate entries per privilege and context", async () => {
    const { state, client } = cached();
    const ctxs = [acme, { organizationId: "globex" }, { organizationId: "acme", subjectId: "alice" },
      { organizationId: "acme", resourceId: "r1" }, { organizationId: "acme", subjectId: "alice", resourceId: "r1" }];
    for (let i = 0; i < 2; i++) {
      for (const ctx of ctxs) await client.getLimit("seat_max", ctx);
      await client.getLimit("project_max", acme);
    }
    assert.equal(state.requests.length, ctxs.length + 1);
  });

  it("never caches an explicit evaluation time", async () => {
    const { state, client } = cached();
    const past = { organizationId: "acme", now: new Date("2026-11-03T00:00:00Z") };
    await client.getLimit("seat_max", past);
    await client.getLimit("seat_max", past);
    assert.equal(state.requests.length, 2);
    assert.equal(state.requests[0]!.body.context.now, "2026-11-03T00:00:00.000Z");
    await client.getLimit("seat_max", acme);
    await client.getLimit("seat_max", acme);
    assert.equal(state.requests.length, 3);
  });

  it("treats a caller-supplied now as explicit even when it equals the current time", async () => {
    const { state, client } = cached();
    const nowish = { organizationId: "acme", now: new Date() };
    await client.getLimit("seat_max", nowish);
    await client.getLimit("seat_max", nowish);
    assert.equal(state.requests.length, 2);
  });

  it("still caches when the client clock is not wall time", async () => {
    const server = fakeServer();
    const provider = new RemoteProvider({ baseUrl: "http://oerep.test", fetch: server.fetch, cacheTtlMs: 10_000, monotonicClock: () => 0 });
    const client = createClient({ catalog, provider, clock: () => new Date("2020-01-01T00:00:00Z") });
    await client.getLimit("seat_max", acme);
    await client.getLimit("seat_max", acme);
    assert.equal(server.state.requests.length, 1);
  });

  it("never caches transport errors or invalid responses", async () => {
    const { state, client } = cached();
    state.fail = true;
    assert.equal((await client.getDetails("seat_max", acme)).reason, Reason.ERROR);
    assert.equal((await client.getDetails("seat_max", acme)).reason, Reason.ERROR);
    state.fail = false;
    state.values.seat_max = "not-an-int";
    assert.equal((await client.getDetails("seat_max", acme)).reason, Reason.ERROR);
    state.values.seat_max = 10;
    assert.equal(await client.getLimit("seat_max", acme), 10);
    assert.equal(state.requests.length, 4);
  });

  it("never caches ERROR resolutions returned by the server", async () => {
    let calls = 0;
    const provider = new RemoteProvider({ baseUrl: "http://oerep.test", cacheTtlMs: 10_000, fetch: async () => {
      calls++;
      return Response.json({ privilege: "seat_max", value: 1, reason: "ERROR", errorCode: "GENERAL", grants: [], staleOverrides: [] });
    } });
    const c = createClient({ catalog, provider });
    await c.getDetails("seat_max", acme);
    await c.getDetails("seat_max", acme);
    assert.equal(calls, 2);
  });

  it("fills single entries from a bulk resolve", async () => {
    const { state, provider, client } = cached();
    const all = await provider.resolveAll(catalog.privileges, acme);
    assert.deepEqual([...all.keys()].sort(), catalog.privileges.map((p) => p.key).sort());
    assert.equal(await client.getLimit("seat_max", acme), 10);
    assert.equal(await client.getEnum("report_retention", acme), "90d");
    assert.equal(await client.isEnabled("sso", acme), true);
    assert.deepEqual(state.requests.map((r) => r.path), ["/oerep/v1/resolve"]);
    await client.getLimit("seat_max", { organizationId: "globex" });
    assert.equal(state.requests.length, 2);
  });

  it("rejects an invalid bulk response without caching any of it", async () => {
    const { state, provider, client } = cached();
    state.values.seat_max = 1.5; // not an integer
    await assert.rejects(provider.resolveAll(catalog.privileges, acme));
    state.values.seat_max = 10;
    await client.getLimit("project_max", acme);
    assert.equal(state.requests.length, 2);
  });

  it("evicts the least recently used entry and clears on demand", async () => {
    const { state, provider, client } = cached({ cacheMaxEntries: 2 });
    const org = (organizationId: string) => client.getLimit("seat_max", { organizationId });
    await org("a"); await org("b");
    await org("a"); // a is now most recently used
    await org("c"); // evicts b
    assert.equal(state.requests.length, 3);
    await org("a");
    assert.equal(state.requests.length, 3);
    await org("b");
    assert.equal(state.requests.length, 4);
    provider.clearCache();
    await org("a");
    assert.equal(state.requests.length, 5);
  });

  it("never caches upgrade suggestions", async () => {
    const { state, client } = cached();
    for (let i = 0; i < 2; i++) assert.equal(await client.requiredPlan("report_retention", "365d", acme), "pro");
    assert.equal(state.requests.filter((r) => r.path.startsWith("/oerep/v1/suggest/")).length, 2);
  });

  it("guard, requireWithin and requireEnabled always fetch the current value and refresh the cache", async () => {
    const { state, client } = cached();
    assert.equal(await client.getLimit("seat_max", acme), 10);
    state.values.seat_max = 3; // limit lowered; the cached entry is still fresh
    assert.equal(await client.getLimit("seat_max", acme), 10);
    assert.equal(state.requests.length, 1);
    await assert.rejects(client.requireWithin("seat_max", 3, 1, acme), EntitlementLimitExceeded);
    assert.equal(state.requests[1]!.path, "/oerep/v1/resolve/seat_max");
    let n = state.requests.length;
    await assert.rejects(client.guard("seat_max", 1, acme, { count: () => 3, act: () => "created" }), EntitlementLimitExceeded);
    assert.equal(state.requests[n]!.path, "/oerep/v1/resolve/seat_max");
    n = state.requests.length;
    assert.equal((await client.guard("seat_max", 1, acme, { count: () => 2, act: () => "ok" })).result, "ok");
    assert.equal(state.requests.length, n + 1);
    assert.equal(await client.getLimit("seat_max", acme), 3); // the fresh fetch refreshed the entry
    assert.equal(state.requests.length, n + 1);
    n = state.requests.length;
    await client.isEnabled("sso", acme);
    await client.isEnabled("sso", acme);
    assert.equal(state.requests.length, n + 1);
    await client.requireEnabled("sso", acme);
    assert.equal(state.requests.length, n + 2);
  });

  it("does not affect providers without a cache", async () => {
    const c = createClient({ catalog, provider: new InMemoryProvider() });
    assert.equal((await c.guard("project_max", 0, { organizationId: "x" }, { count: () => 0, act: () => 1 })).result, 1);
  });

  it("rejects invalid cache options", () => {
    for (const bad of [{ cacheTtlMs: 0 }, { cacheTtlMs: -1 }, { cacheTtlMs: Infinity }, { cacheTtlMs: NaN }, { cacheTtlMs: "5" as unknown as number },
      { cacheMaxEntries: 0 }, { cacheMaxEntries: 1.5 }, { cacheMaxEntries: -3 }, { cacheMaxEntries: Infinity }])
      assert.throws(() => new RemoteProvider({ baseUrl: "http://localhost:1", ...bad }), /cache/);
  });
});

describe("RemoteProvider cache provenance and refresh regressions", () => {
  it("direct historical resolve neither reads nor poisons current-time entries", async () => {
    const { provider, client, state } = cached();
    const p = catalog.privilege("seat_max")!;
    const past = { ...acme, now: new Date("2020-01-01T00:00:00Z") };
    assert.equal((await provider.resolve(p, past)).value, 10);
    state.values.seat_max = 20;
    assert.equal(await client.getLimit("seat_max", acme), 20);
    state.values.seat_max = 30;
    assert.equal((await provider.resolve(p, past)).value, 30);
    assert.equal(await client.getLimit("seat_max", acme), 20);
    assert.equal(state.requests.length, 3);
    assert.equal((await provider.resolve(p, past, { fresh: true, explicitTime: false })).value, 30);
    assert.equal(await client.getLimit("seat_max", acme), 30);
    assert.equal(state.requests.length, 4);
  });

  for (const explicit of [false, true]) it(`guard preserves ${explicit ? "caller" : "SDK"} time provenance`, async () => {
    const { client, state } = cached();
    assert.equal(await client.getLimit("seat_max", acme), 10);
    state.values.seat_max = 20;
    const ctx = explicit ? { ...acme, now: new Date("2020-01-01T00:00:00Z") } : acme;
    assert.equal((await client.guard("seat_max", 1, ctx, { count: () => 0, act: () => "ok" })).details.value, 20);
    assert.equal(await client.getLimit("seat_max", acme), explicit ? 10 : 20);
    assert.equal(state.requests.length, 2);
  });

  for (const bulk of [false, true]) for (const failure of ["transport", "invalid", "error"]) {
    it(`evicts previous success after ${bulk ? "bulk" : "single"} ${failure} refresh`, async () => {
      const server = fakeServer();
      let failing = false;
      const provider = new RemoteProvider({ baseUrl: "http://oerep.test", cacheTtlMs: 10_000, fetch: async (url, init) => {
        if (failing && failure === "transport") return new Response("down", { status: 500 });
        const response = await server.fetch(url, init);
        if (!failing) return response;
        const data = await response.json();
        for (const entry of data.privileges ?? [data]) if (entry.privilege === "seat_max") {
          if (failure === "invalid") entry.value = "invalid";
          else Object.assign(entry, { reason: "ERROR", errorCode: "GENERAL" });
        }
        return Response.json(data);
      } });
      const client = createClient({ catalog, provider });
      await client.getLimit("seat_max", acme);
      await client.getLimit("project_max", acme);
      failing = true;
      if (bulk) {
        if (failure === "error") assert.equal((await provider.resolveAll(catalog.privileges, acme)).get("seat_max")!.reason, Reason.ERROR);
        else await assert.rejects(provider.resolveAll(catalog.privileges, acme));
      } else await assert.rejects(client.requireWithin("seat_max", 0, 100, acme), EntitlementLimitExceeded);
      failing = false;
      server.state.values.seat_max = 30;
      let n = server.state.requests.length;
      assert.equal(await client.getLimit("seat_max", acme), 30);
      assert.equal(server.state.requests.length, n + 1);
      n = server.state.requests.length;
      assert.equal(await client.getLimit("project_max", acme), 5);
      assert.equal(server.state.requests.length, n + (bulk && failure !== "error" ? 1 : 0));
    });
  }

  it("snapshots caller-owned transport options", async () => {
    const requests: { url: string; authorization: string | null }[] = [];
    const options: RemoteProviderOptions = { baseUrl: "http://authority-a.test", token: "authority-a", cacheTtlMs: 10_000,
      fetch: async (url, init) => {
        requests.push({ url: String(url), authorization: new Headers(init!.headers).get("authorization") });
        return Response.json({ privilege: "seat_max", value: requests.length * 10, reason: "PLAN", grants: [], staleOverrides: [] });
      } };
    const provider = new RemoteProvider(options);
    const client = createClient({ catalog, provider });
    assert.equal(await client.getLimit("seat_max", acme), 10);
    options.baseUrl = "http://authority-b.test";
    options.token = "authority-b";
    options.fetch = async () => { throw new Error("mutated fetch must not run"); };
    await client.requireWithin("seat_max", 0, 1, acme);
    assert.equal(await client.getLimit("seat_max", acme), 20);
    assert.deepEqual(requests, Array(2).fill({ url: "http://authority-a.test/oerep/v1/resolve/seat_max", authorization: "Bearer authority-a" }));
  });
});

it("historical bulk neither seeds nor evicts the current cache", async () => {
  const { provider, client, state } = cached();
  const past = { ...acme, now: new Date("2020-01-01T00:00:00Z") };
  await provider.resolveAll(catalog.privileges, past);
  state.values.seat_max = 20;
  assert.equal(await client.getLimit("seat_max", acme), 20);
  state.values.seat_max = 30;
  assert.equal((await provider.resolveAll(catalog.privileges, past)).get("seat_max")!.value, 30);
  assert.equal(await client.getLimit("seat_max", acme), 20);
  state.fail = true;
  await assert.rejects(provider.resolveAll(catalog.privileges, past));
  assert.equal(await client.getLimit("seat_max", acme), 20);
  assert.equal(state.requests.length, 4);
});
