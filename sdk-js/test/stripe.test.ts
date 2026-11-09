import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { describe, it } from "node:test";
import { boolean, Catalog, createClient, enumeration, feature, integer, Reason, UNLIMITED } from "@openentitlement/core";
import { parseLookupKey, StripeEntitlementsProvider, verifyWebhook, type Transport } from "@openentitlement/stripe";

const CATALOG = new Catalog([
  feature("seats", "Seats", [integer("seat_max", { default: 1, unlimitedAllowed: true })]),
  feature("sso", "SSO", [boolean("sso_enabled")]),
  feature("support", "Support", [boolean("support.enabled"), enumeration("support.tier", ["community", "priority"])], { gate: "support.enabled" }),
]);

function paged(pages: string[][]): Transport & { calls: string[] } {
  const calls: string[] = [];
  const t = (async (url: string) => {
    const i = calls.length;
    calls.push(url);
    const data = pages[i]!.map((k, j) => ({ id: `ent_${i}_${j}`, lookup_key: k }));
    return { status: 200, body: JSON.stringify({ data, has_more: i < pages.length - 1 }) };
  }) as unknown as Transport & { calls: string[] };
  t.calls = calls;
  return t;
}

function sequence(responses: string[][]): Transport & { calls: string[] } {
  const calls: string[] = [];
  const t = (async (url: string) => {
    const keys = responses[calls.length]!;
    calls.push(url);
    return { status: 200, body: JSON.stringify({ data: keys.map((k, i) => ({ id: `e${i}`, lookup_key: k })), has_more: false }) };
  }) as unknown as Transport & { calls: string[] };
  t.calls = calls;
  return t;
}

const setup = (transport: Transport, extra: Partial<ConstructorParameters<typeof StripeEntitlementsProvider>[0]> = {}) => {
  const p = new StripeEntitlementsProvider({ apiKey: "sk_test", customerFor: (o) => (o === "acme" ? "cus_1" : undefined), transport, logger: { warn() {} }, ...extra });
  return { p, c: createClient({ provider: p, catalog: CATALOG, context: { organizationId: "acme" } }) };
};

describe("stripe adapter", () => {
  it("parses the lookup key convention", () => {
    assert.deepEqual(parseLookupKey("seat_max:50"), ["seat_max", "50"]);
    assert.deepEqual(parseLookupKey("sso_enabled"), ["sso_enabled", undefined]);
  });

  it("paginates, picks the most generous value, and caches", async () => {
    const t = paged([["seat_max:10", "sso_enabled"], ["seat_max:50", "support.tier:priority"]]);
    const { c } = setup(t);
    assert.equal(await c.getLimit("seat_max"), 50);
    assert.match(t.calls[1]!, /starting_after=ent_0_1/);
    assert.ok(await c.isEnabled("sso"));
    assert.equal(await c.getEnum("support.tier"), "priority");
    const support = await c.isEnabledDetails("support");
    assert.equal(support.value, false);
    assert.equal(support.reason, Reason.PLAN);
    assert.equal(t.calls.length, 2);
  });

  it("supports unlimited and explicit mappings", async () => {
    assert.equal(await setup(sequence([["seat_max:unlimited"]])).c.getLimit("seat_max"), UNLIMITED);
    const { c } = setup(sequence([["pro-bundle"]]), { mapping: { "pro-bundle": { "seat_max": 25, "sso_enabled": true } } });
    assert.equal(await c.getLimit("seat_max"), 25);
    assert.ok(await c.isEnabled("sso"));
  });

  it("ignores invalid keys and defaults unknown customers", async () => {
    const { c } = setup(sequence([["seat_max:lots"]]));
    assert.equal((await c.getLimitDetails("seat_max")).reason, Reason.DEFAULT);
    assert.equal((await c.getLimitDetails("seat_max", { organizationId: "other" })).reason, Reason.DEFAULT);
  });

  it("turns API errors into reason ERROR", async () => {
    const { c } = setup(async () => ({ status: 401, body: "{}" }));
    const d = await c.getLimitDetails("seat_max");
    assert.equal(d.reason, Reason.ERROR);
    assert.equal(d.value, 1);
  });

  it("refreshes the cache from webhooks and invalidates truncated summaries", async () => {
    const t = sequence([["seat_max:10"], ["seat_max:99"]]);
    const { p, c } = setup(t, { cacheTtl: 3600 });
    assert.equal(await c.getLimit("seat_max"), 10);
    p.handleEvent({ type: "entitlements.active_entitlement_summary.updated", data: { object: { customer: "cus_1", entitlements: { data: [{ lookup_key: "seat_max:20" }], has_more: false } } } });
    assert.equal(await c.getLimit("seat_max"), 20);
    assert.equal(t.calls.length, 1);
    p.handleEvent({ type: "entitlements.active_entitlement_summary.updated", data: { object: { customer: "cus_1", entitlements: { data: [], has_more: true } } } });
    assert.equal(await c.getLimit("seat_max"), 99);
    assert.equal(t.calls.length, 2);
  });

  it("verifies webhook signatures", () => {
    const payload = '{"type":"x"}';
    const sign = (secret: string, t: number) => `t=${t},v1=${createHmac("sha256", secret).update(`${t}.${payload}`).digest("hex")}`;
    assert.deepEqual(verifyWebhook(payload, sign("whsec", 1000), "whsec", { now: 1010 }), { type: "x" });
    assert.throws(() => verifyWebhook(payload, sign("other", 1000), "whsec", { now: 1010 }));
    assert.throws(() => verifyWebhook(payload, sign("whsec", 1000), "whsec", { now: 5000 }));
    assert.throws(() => verifyWebhook(payload, "v1=abc", "whsec"));
  });
});
