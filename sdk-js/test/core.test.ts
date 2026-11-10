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
  feature("seats", "Seats", [integer("seat_max", { default: 1, unlimitedAllowed: true })]),
  feature("projects", "Projects", [integer("project_max")]),
  feature("sso", "SSO", [boolean("sso_enabled"), integer("sso_connection_max")], { gate: "sso_enabled" }),
  feature("reports", "Reports", [boolean("reports_enabled"), enumeration("report_retention", ["7d", "90d"])], { gate: "reports_enabled" }),
]);

const provider = () =>
  new InMemoryProvider({
    plans: [
      { id: "free", name: "Free", rank: 0 },
      { id: "pro", name: "Pro", rank: 1 },
    ],
    values: { free: { "seat_max": 3, "project_max": 1, "sso_enabled": false }, pro: { "seat_max": UNLIMITED, "project_max": 5, "sso_enabled": true } },
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
    [feature("a", "A", [boolean("a_x"), boolean("a_y")])],
    [feature("a", "A", [enumeration("a_tier", ["x"])])],
    [feature("a", "A", [boolean("a_x")]), feature("b", "B", [boolean("a_x")])],
    [feature("a", "A", [integer("a_max", { default: -1 })])],
    [feature("a", "A", [integer("a_max", { default: UNLIMITED })])],
    [feature("a", "A", [])],
    [feature("a", "A", [boolean("a_x")], { gate: "b_y" })],
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
      const d = await c.getLimitDetails("seat_max");
      assert.equal(d.reason, Reason.ERROR);
      assert.equal(d.errorCode, code);
      assert.equal(d.value, 1);
      assert.equal(await c.isEnabled("sso"), false);
      await assert.rejects(c.requireWithin("seat_max", 1, 1), (e: any) => e instanceof EntitlementLimitExceeded && e.requiredPlan === undefined);
    });
});

describe("client", () => {
  it("merges the default context with the invocation", async () => {
    const c = createClient({ provider: provider(), catalog: CATALOG, context: acme });
    assert.equal(await c.getLimit("seat_max"), 3);
    assert.equal(await c.getLimit("seat_max", { organizationId: "nobody" }), 1);
  });

  it("raises type and argument errors", async () => {
    const c = createClient({ provider: provider(), catalog: CATALOG, context: acme });
    await assert.rejects(c.requireWithin("sso_enabled", 0, 1), TypeMismatch);
    await assert.rejects(c.requireWithin("seat_max", 0, 1.5), InvalidArgument);
    assert.equal((await c.getEnumDetails("seat_max")).errorCode, ErrorCode.TYPE_MISMATCH);
  });

  it("maps denials with usage breakdowns to a 403 problem", async () => {
    const c = createClient({ provider: provider(), catalog: CATALOG, context: acme });
    const e = await c.requireWithin("seat_max", { pool: 3, subject: 0 }, 1).catch((x) => x);
    const { status, body } = toHttpProblem(e);
    assert.equal(status, 403);
    assert.deepEqual(body.current, { pool: 3, subject: 0 });
    assert.equal(body.requiredPlan, "pro");
  });

  it("rejects admin calls on read-only providers", async () => {
    const c = createClient({ provider: new FixedProvider(CATALOG, { "project_max": 9, "sso_connection_max": 1 }), catalog: CATALOG });
    await assert.rejects(c.admin.setPlanValue("pro", "seat_max", 1, { actor: "a", reason: "b" }), NotSupported);
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
    assert.equal(await c.getLimit("seat_max"), 3);
    assert.deepEqual(log, ["a.before", "b.before", "b.after:PLAN", "a.after:PLAN", "b.finally", "a.finally"]);
  });

  it("a before-hook failure short-circuits to ERROR", async () => {
    const log: string[] = [];
    const c = createClient({ provider: provider(), catalog: CATALOG, context: acme, hooks: [recorder("a", log, { failBefore: true })] });
    assert.equal((await c.getLimitDetails("seat_max")).reason, Reason.ERROR);
    assert.deepEqual(log, ["a.before", "a.error", "a.finally"]);
  });

  it("denials run after hooks, not error hooks", async () => {
    const log: string[] = [];
    const c = createClient({ provider: provider(), catalog: CATALOG, context: acme, hooks: [recorder("a", log)] });
    await assert.rejects(c.requireWithin("project_max", 1, 1), EntitlementLimitExceeded);
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
          .guard("project_max", 1, acme, {
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
    assert.equal(await race(new InProcessLock()), 1); // free plan: project_max = 1
    assert.ok((await race(noLock)) > 1); // without a lock, the race overshoots
  });

  it("releases the lock on error and reports its domain", async () => {
    const c = createClient({ provider: provider(), catalog: CATALOG });
    await assert.rejects(c.guard("project_max", 1, acme, { count: () => 0, act: () => { throw new RangeError("x"); } }), RangeError);
    const r = await c.guard("project_max", 1, acme, { count: () => 0, act: () => "ok" });
    assert.equal(r.result, "ok");
    assert.equal(r.details.lockDomain, "process");
  });
});

describe("context precedence", () => {
  it("rejects explicit invalid tenant IDs instead of inheriting the client's tenant", async () => {
    const c = createClient({ catalog: CATALOG, provider: provider(), context: acme });
    assert.equal(await c.getLimit("seat_max", { subjectId: "alice" }), 3);
    for (const organizationId of ["", null, false, 0]) {
      const d = await c.getDetails("seat_max", { organizationId } as any);
      assert.equal(d.reason, Reason.ERROR);
      assert.equal(d.errorCode, ErrorCode.INVALID_CONTEXT);
      assert.equal(d.value, 1);
    }
  });
});

describe("read-only inspection", () => {
  it("returns detached facts and audit records that cannot change entitlement state", async () => {
    const p = provider();
    const c = createClient({ catalog: CATALOG, provider: p, context: acme });
    const meta = { actor: "support", reason: "contract" };
    const event = await c.admin.createOverride({ organizationId: "acme", privilege: "seat_max", value: 5, expiresAt: new Date("2050-01-01T00:00:00Z") }, meta);
    await c.admin.createGrant({ organizationId: "acme", privilege: "seat_max", amount: 2 }, meta);
    (await p.inspection.listAssignments())[0]!.planId = "pro";
    const o = (await p.inspection.listOverrides("acme"))[0]!;
    o.value = 999; o.scope.organizationId = "other"; o.expiresAt!.setUTCFullYear(2000);
    (await p.inspection.listGrants("acme"))[0]!.amount = 1000;
    const audit = await p.inspection.listAudit();
    audit[0]!.reason = "rewritten";
    (audit[0]!.after as any).amount = 1000;
    event.reason = "rewritten by mutation caller";
    assert.equal(await c.getLimit("seat_max"), 7);
    const retained = await p.inspection.listAudit();
    assert.ok(retained.every((e) => e.reason === "contract"));
    assert.equal((retained[0]!.after as any).amount, 2);
    assert.equal((await p.inspection.listPlans()).find((p) => p.id === "pro")!.values["seat_max"], UNLIMITED);
  });
});

describe("usage validation", () => {
  it("rejects missing or null pool usage instead of assuming zero", async () => {
    const c = createClient({ catalog: CATALOG, provider: provider(), context: acme });
    for (const usage of [{}, [], { subject: 1 }, { pool: null }, { pool: 0, subject: null }])
      await assert.rejects(c.requireWithin("seat_max", usage as any, 1), InvalidArgument);
    await c.requireWithin("seat_max", { pool: 0 }, 1);
  });
});

describe("guard ordering", () => {
  it("resolves once before counting and checks that same entitlement snapshot", async () => {
    const order: string[] = [];
    let limit = 1;
    const p: Provider = { metadata: { name: "changing" }, capabilities: { overrides: false, grants: false, mutations: false, planCatalog: false, fixed: false }, async resolve(privilege) { order.push("resolve"); return { privilege: privilege.key, value: limit, reason: Reason.PLAN, grants: [], staleOverrides: [] }; } };
    const c = createClient({ catalog: CATALOG, provider: p });
    await assert.rejects(c.guard("project_max", 2, acme, { count: () => { order.push("count"); limit = 10; return 0; }, act: () => { order.push("act"); } }), EntitlementLimitExceeded);
    assert.deepEqual(order, ["resolve", "count"]);
  });
});
