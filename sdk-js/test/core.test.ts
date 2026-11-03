import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  Catalog,
  createClient,
  decodeValue,
  EntitlementLimitExceeded,
  enumeration,
  ErrorCode,
  feature,
  FixedProvider,
  fits,
  InMemoryProvider,
  InProcessLock,
  integer,
  boolean,
  InvalidArgument,
  isUnlimited,
  NotSupported,
  ProviderNotReady,
  Reason,
  toHttpProblem,
  TypeMismatch,
  UNLIMITED,
  type Hook,
  type Lock,
  type Provider,
} from "@openentitlement/core";

const CATALOG = new Catalog([
  feature("seats", "Seats", [integer("seats.max", { default: 1, unlimitedAllowed: true })]),
  feature("projects", "Projects", [integer("projects.max")]),
  feature("sso", "SSO", [boolean("sso.enabled"), integer("sso.connections.max")], { gate: "sso.enabled" }),
  feature("reports", "Reports", [boolean("reports.enabled"), enumeration("reports.retention", ["7d", "90d"])], { gate: "reports.enabled" }),
]);

const provider = () =>
  new InMemoryProvider({
    plans: [
      { id: "free", name: "Free", rank: 0 },
      { id: "pro", name: "Pro", rank: 1 },
    ],
    values: { free: { "seats.max": 3, "projects.max": 1, "sso.enabled": false }, pro: { "seats.max": UNLIMITED, "projects.max": 5, "sso.enabled": true } },
    assignments: { acme: "free" },
  });

const acme = { organizationId: "acme" };

describe("UNLIMITED", () => {
  it("is distinct, serializes to an object, and refuses numeric coercion", () => {
    assert.ok(isUnlimited(UNLIMITED) && !isUnlimited(Number.MAX_SAFE_INTEGER) && !isUnlimited(Infinity));
    assert.equal(JSON.stringify({ v: UNLIMITED }), '{"v":{"unlimited":true}}');
    assert.equal(decodeValue({ unlimited: true }), UNLIMITED);
    assert.throws(() => decodeValue({ unlimited: false }));
    assert.throws(() => +(UNLIMITED as any));
    assert.ok(fits(1e15, UNLIMITED) && fits(3, 3) && !fits(4, 3));
    assert.ok(Object.isFrozen(UNLIMITED));
  });
});

describe("catalog validation is eager", () => {
  const bad = [
    [feature("Bad", "x", [boolean("a")])],
    [feature("a", "A", [boolean("a.x"), boolean("a.y")])],
    [feature("a", "A", [enumeration("a.tier", ["x"])])],
    [feature("a", "A", [boolean("a.x")]), feature("b", "B", [boolean("a.x")])],
    [feature("a", "A", [integer("a.max", { default: -1 })])],
    [feature("a", "A", [integer("a.max", { default: UNLIMITED })])],
    [feature("a", "A", [])],
    [feature("a", "A", [boolean("a.x")], { gate: "b.y" })],
  ];
  for (const [i, f] of bad.entries()) it(`rejects invalid catalog #${i}`, () => assert.throws(() => new Catalog(f), InvalidArgument));
});

describe("failures never throw from evaluation and fail closed", () => {
  const cases: Array<[string, Provider, string]> = [
    ["throws", { metadata: { name: "boom" }, capabilities: provider().capabilities, resolve: async () => { throw new Error("db down"); } }, ErrorCode.GENERAL],
    ["init fails", { metadata: { name: "nr" }, capabilities: provider().capabilities, initialize: async () => { throw new Error("nope"); }, resolve: async () => { throw new Error("unreachable"); } }, ErrorCode.PROVIDER_NOT_READY],
    ["signals not ready", { metadata: { name: "s" }, capabilities: provider().capabilities, resolve: async () => { throw new ProviderNotReady("warming"); } }, ErrorCode.PROVIDER_NOT_READY],
    ["returns garbage", { metadata: { name: "g" }, capabilities: provider().capabilities, resolve: async (p) => ({ privilege: p.key, value: "lots", reason: Reason.PLAN, grants: [], staleOverrides: [] }) }, ErrorCode.GENERAL],
  ];
  for (const [name, p, code] of cases)
    it(name, async () => {
      const c = createClient({ provider: p, catalog: CATALOG, context: acme, logger: { error() {} } });
      const d = await c.getLimitDetails("seats.max");
      assert.equal(d.reason, Reason.ERROR);
      assert.equal(d.errorCode, code);
      assert.equal(d.value, 1);
      assert.equal(await c.isEnabled("sso"), false);
      await assert.rejects(c.requireWithin("seats.max", 1, 1), (e: any) => e instanceof EntitlementLimitExceeded && e.requiredPlan === undefined);
    });
});

describe("client", () => {
  it("merges the default context with the invocation", async () => {
    const c = createClient({ provider: provider(), catalog: CATALOG, context: acme });
    assert.equal(await c.getLimit("seats.max"), 3);
    assert.equal(await c.getLimit("seats.max", { organizationId: "nobody" }), 1);
  });

  it("raises type and argument errors", async () => {
    const c = createClient({ provider: provider(), catalog: CATALOG, context: acme });
    await assert.rejects(c.requireWithin("sso.enabled", 0, 1), TypeMismatch);
    await assert.rejects(c.requireWithin("seats.max", 0, 1.5), InvalidArgument);
    assert.equal((await c.getEnumDetails("seats.max")).errorCode, ErrorCode.TYPE_MISMATCH);
  });

  it("maps denials with usage breakdowns to a 403 problem", async () => {
    const c = createClient({ provider: provider(), catalog: CATALOG, context: acme });
    const e = await c.requireWithin("seats.max", { pool: 3, subject: 0 }, 1).catch((x) => x);
    const { status, body } = toHttpProblem(e);
    assert.equal(status, 403);
    assert.deepEqual(body.current, { pool: 3, subject: 0 });
    assert.equal(body.requiredPlan, "pro");
  });

  it("rejects admin calls on read-only providers", async () => {
    const c = createClient({ provider: new FixedProvider(CATALOG, { "projects.max": 9, "sso.connections.max": 1 }), catalog: CATALOG });
    await assert.rejects(c.admin.setPlanValue("pro", "seats.max", 1, { actor: "a", reason: "b" }), NotSupported);
  });
});

describe("hooks", () => {
  const recorder = (name: string, log: string[], opts: { failBefore?: boolean; failAfter?: boolean } = {}): Hook => ({
    before: () => {
      log.push(`${name}.before`);
      if (opts.failBefore) throw new Error("nope");
    },
    after: (_c, d) => {
      log.push(`${name}.after:${d.reason}`);
      if (opts.failAfter) throw new Error("ignored");
    },
    error: () => void log.push(`${name}.error`),
    finally: () => void log.push(`${name}.finally`),
  });

  it("run in order, and after-hook failures do not change results", async () => {
    const log: string[] = [];
    const c = createClient({ provider: provider(), catalog: CATALOG, context: acme, hooks: [recorder("a", log), recorder("b", log, { failAfter: true })], logger: { error() {} } });
    assert.equal(await c.getLimit("seats.max"), 3);
    assert.deepEqual(log, ["a.before", "b.before", "b.after:PLAN", "a.after:PLAN", "b.finally", "a.finally"]);
  });

  it("a before-hook failure short-circuits to ERROR", async () => {
    const log: string[] = [];
    const c = createClient({ provider: provider(), catalog: CATALOG, context: acme, hooks: [recorder("a", log, { failBefore: true })] });
    assert.equal((await c.getLimitDetails("seats.max")).reason, Reason.ERROR);
    assert.deepEqual(log, ["a.before", "a.error", "a.finally"]);
  });

  it("denials run after hooks, not error hooks", async () => {
    const log: string[] = [];
    const c = createClient({ provider: provider(), catalog: CATALOG, context: acme, hooks: [recorder("a", log)] });
    await assert.rejects(c.requireWithin("projects.max", 1, 1), EntitlementLimitExceeded);
    assert.deepEqual(log, ["a.before", "a.after:PLAN", "a.finally"]);
  });
});

describe("guard", () => {
  const noLock: Lock = { domain: "none", run: (_k, fn) => fn(undefined) };
  const race = async (lock: Lock) => {
    const c = createClient({ provider: provider(), catalog: CATALOG, lock });
    let n = 0;
    await Promise.all(
      Array.from({ length: 20 }, () =>
        c
          .guard("projects.max", 1, acme, {
            count: async () => {
              const v = n;
              await new Promise((r) => setTimeout(r, 2));
              return v;
            },
            act: () => void (n += 1),
          })
          .catch((e) => {
            if (!(e instanceof EntitlementLimitExceeded)) throw e;
          }),
      ),
    );
    return n;
  };

  it("serializes check-then-act, and the test has teeth", async () => {
    assert.equal(await race(new InProcessLock()), 1); // free plan: projects.max = 1
    assert.ok((await race(noLock)) > 1); // without a lock, the race overshoots
  });

  it("releases the lock on error and reports its domain", async () => {
    const c = createClient({ provider: provider(), catalog: CATALOG });
    await assert.rejects(c.guard("projects.max", 1, acme, { count: () => 0, act: () => { throw new RangeError("x"); } }), RangeError);
    const r = await c.guard("projects.max", 1, acme, { count: () => 0, act: () => "ok" });
    assert.equal(r.result, "ok");
    assert.equal(r.details.lockDomain, "process");
  });
});
