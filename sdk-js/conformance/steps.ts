/** Step definitions for the OpenEntitlement conformance suite (spec/assets/gherkin). */

import assert from "node:assert/strict";
import {
  AuditLog,
  auditEventToJSON,
  decodeValue,
  detailsToJSON,
  EntitlementDenied,
  EntitlementLimitExceeded,
  FixedProvider,
  poolUsage,
  toHttpProblem,
  UNLIMITED,
  createClient,
  type AuditEvent,
  type Catalog,
  type EntitlementClient,
  type EvaluationContext,
  type Lock,
  type MutationHook,
  type Provider,
  type ResolutionDetails,
} from "@openentitlement/core";

const ACTOR = "conformance";
const REASON = "conformance setup";

export interface Counter {
  count(tx: any): Promise<number>;
  increment(tx: any): Promise<void>;
  value(): Promise<number>;
}

/** What a harness needs per provider. Third-party providers implement this and reuse the steps. */
export interface Target {
  name: string;
  tags: Set<string>;
  setup(world: World): Promise<void>;
  counter(org: string): Promise<Counter>;
  teardown?(): Promise<void>;
}

/** Seeds Given-state: the admin client for mutable providers, a back door for others. */
export interface Seeder {
  upsertPlan(plan: any, meta: { actor: string; reason: string }): Promise<unknown>;
  setPlanValue(planId: string, privilege: string, value: unknown, meta: { actor: string; reason: string }): Promise<unknown>;
  assignPlan(org: string, planId: string | null, meta: { actor: string; reason: string; channel?: string }): Promise<unknown>;
  createOverride(input: any, meta: { actor: string; reason: string }): Promise<unknown>;
  createGrant(input: any, meta: { actor: string; reason: string }): Promise<unknown>;
}

class Vetoed extends Error {
  readonly code = "VETOED";
}

export class World {
  now = new Date("2026-06-15T12:00:00Z");
  client: EntitlementClient | undefined;
  seeder: Seeder | undefined;
  audit = new AuditLog();
  vetoActive = false;
  details: ResolutionDetails | undefined;
  denial: EntitlementDenied | undefined;
  checkRan = false;
  error: unknown;
  errorConsumed = true;
  whenStarted = false;
  event: AuditEvent | undefined;
  pool: number | undefined;
  guardResults: Array<any> = [];
  counter: Counter | undefined;
  readonly target: Target;
  readonly catalog: Catalog;
  readonly plans: any;

  constructor(target: Target, catalog: Catalog, plans: any) {
    this.target = target;
    this.catalog = catalog;
    this.plans = plans;
  }

  makeClient(provider: Provider, lock?: Lock<any>): void {
    const veto: MutationHook = {
      before: () => {
        if (this.vetoActive) throw new Vetoed("vetoed by policy hook");
      },
    };
    this.client = createClient({ provider, catalog: this.catalog, clock: () => this.now, mutationHooks: [veto, this.audit], ...(lock ? { lock } : {}) });
  }
}

export function parseValue(raw: string): unknown {
  raw = raw.trim();
  if (raw === "true") return true;
  if (raw === "false") return false;
  if (raw === "unlimited") return UNLIMITED;
  if (raw.startsWith('"') && raw.endsWith('"')) return raw.slice(1, -1);
  return Number(raw);
}

const ts = (raw: string) => new Date(raw);
const json = (v: unknown) => JSON.parse(JSON.stringify(v ?? null));

const SCOPE = String.raw`(?<scope>(?:subject "[^"]*" and resource "[^"]*"|subject "[^"]*"|resource "[^"]*") of organization "[^"]*"|organization "[^"]*")`;
const VALUE = String.raw`(?<value>true|false|unlimited|-?\d+|"[^"]*")`;
const DATES = String.raw`(?: from "(?<from>[^"]+)")?(?: until "(?<until>[^"]+)")?`;

function parseScope(text: string) {
  const org = /organization "([^"]*)"/.exec(text)?.[1] ?? "";
  const sub = /subject "([^"]*)"/.exec(text)?.[1];
  const res = /resource "([^"]*)"/.exec(text)?.[1];
  return { organizationId: org, ...(sub !== undefined ? { subjectId: sub } : {}), ...(res !== undefined ? { resourceId: res } : {}) };
}

function ctxOf(scope: string, at?: string): EvaluationContext {
  return { ...parseScope(scope), ...(at ? { now: ts(at) } : {}) };
}

function dates(g: Record<string, string | undefined>) {
  return { ...(g.from ? { startsAt: ts(g.from) } : {}), ...(g.until ? { expiresAt: ts(g.until) } : {}) };
}

type Fn = (w: World, g: Record<string, string | undefined>) => unknown;
const STEPS: Array<{ kw: string; re: RegExp; fn: Fn }> = [];
const step = (kw: string, pattern: string, fn: Fn) => STEPS.push({ kw, re: new RegExp(`^${pattern}$`), fn });

async function capture(w: World, fn: () => Promise<unknown> | unknown): Promise<unknown> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof EntitlementDenied) w.denial = e;
    else {
      w.error = e;
      w.errorConsumed = false;
    }
    return undefined;
  }
}

const codeOf = (e: any) => e?.code ?? e?.constructor?.name;
const c = (w: World) => w.client!;

// ---------------------------------------------------------------- Given

step("Given", "the standard plans", async (w) => {
  await w.target.setup(w);
  for (const p of w.plans.plans) {
    const plan: any = { id: p.id, name: p.name };
    if (p.rank !== undefined) plan.rank = p.rank;
    if (p.public !== undefined) plan.public = p.public;
    if (p.variantOf !== undefined) plan.variantOf = p.variantOf;
    await w.seeder!.upsertPlan(plan, { actor: ACTOR, reason: REASON });
    for (const [k, raw] of Object.entries(p.values)) await w.seeder!.setPlanValue(p.id, k, decodeValue(raw), { actor: ACTOR, reason: REASON });
  }
});

step("Given", String.raw`the clock is "(?<at>[^"]+)"`, (w, g) => {
  w.now = ts(g.at!);
});

step("Given", String.raw`organization "(?<org>[^"]*)" is on plan "(?<plan>[^"]*)"(?: paid by "(?<channel>[^"]*)")?`, (w, g) =>
  w.seeder!.assignPlan(g.org!, g.plan!, { actor: ACTOR, reason: REASON, ...(g.channel ? { channel: g.channel } : {}) }),
);

step("Given", String.raw`organization "(?<org>[^"]*)" has no plan`, () => undefined);

step("Given", String.raw`an override "(?<id>[^"]*)" sets "(?<priv>[^"]*)" to ${VALUE} for ${SCOPE}${DATES}`, (w, g) =>
  w.seeder!.createOverride({ ...parseScope(g.scope!), privilege: g.priv!, value: parseValue(g.value!), id: g.id!, ...dates(g) }, { actor: ACTOR, reason: "negotiated contract" }),
);

step("Given", String.raw`a grant "(?<id>[^"]*)" adds (?<amount>\d+) "(?<priv>[^"]*)" for ${SCOPE}${DATES}`, (w, g) => {
  const { resourceId: _r, ...scope } = parseScope(g.scope!) as any;
  return w.seeder!.createGrant({ ...scope, privilege: g.priv!, amount: Number(g.amount), id: g.id!, ...dates(g) }, { actor: ACTOR, reason: "pack" });
});

const fixedValues = (raw: string) => Object.fromEntries(Object.entries(JSON.parse(raw)).map(([k, v]) => [k, decodeValue(v)]));

step("Given", String.raw`a fixed provider configured with (?<raw>\{.*\})`, (w, g) => {
  w.makeClient(new FixedProvider(w.catalog, fixedValues(g.raw!)));
});

step("Given", "a mutation hook that vetoes every change", (w) => {
  w.vetoActive = true;
});

// ---------------------------------------------------------------- When: mutations

step("When", String.raw`I try to make plan "(?<plan>[^"]*)" a variant of "(?<base>[^"]*)"`, (w, g) =>
  capture(w, () => c(w).admin.upsertPlan({ id: g.plan!, name: g.plan!, variantOf: g.base! }, { actor: "pricing", reason: "plan family update" })),
);

step("When", String.raw`organization "(?<org>[^"]*)" moves to plan "(?<plan>[^"]*)"`, (w, g) =>
  capture(w, () => w.seeder!.assignPlan(g.org!, g.plan!, { actor: "billing", reason: "plan change" })),
);
step("When", String.raw`organization "(?<org>[^"]*)" loses its plan`, (w, g) =>
  capture(w, () => w.seeder!.assignPlan(g.org!, null, { actor: "billing", reason: "cancelled" })),
);
step("When", String.raw`override "(?<id>[^"]*)" is deleted`, (w, g) => capture(w, () => c(w).admin.deleteOverride(g.id!, { actor: "support", reason: "contract ended" })));
step("When", String.raw`grant "(?<id>[^"]*)" is revoked`, (w, g) => capture(w, () => c(w).admin.revokeGrant(g.id!, { actor: "support", reason: "refund" })));
step("When", String.raw`"(?<actor>[^"]*)" sets plan "(?<plan>[^"]*)" "(?<priv>[^"]*)" to ${VALUE} because "(?<reason>[^"]*)"`, (w, g) =>
  capture(w, () => c(w).admin.setPlanValue(g.plan!, g.priv!, parseValue(g.value!), { actor: g.actor!, reason: g.reason! })),
);
step("When", String.raw`"(?<actor>[^"]*)" sets plan "(?<plan>[^"]*)" "(?<priv>[^"]*)" to ${VALUE} without a reason`, (w, g) =>
  capture(w, () => c(w).admin.setPlanValue(g.plan!, g.priv!, parseValue(g.value!), { actor: g.actor!, reason: "" })),
);
step("When", String.raw`I try to create an override "(?<id>[^"]*)" setting "(?<priv>[^"]*)" to ${VALUE} for ${SCOPE}${DATES}`, (w, g) =>
  capture(w, () =>
    c(w).admin.createOverride({ ...parseScope(g.scope!), privilege: g.priv!, value: parseValue(g.value!), id: g.id!, ...dates(g) }, { actor: "support", reason: "negotiated contract" }),
  ),
);
step("When", String.raw`I try to grant (?<amount>-?\d+) "(?<priv>[^"]*)" to organization "(?<org>[^"]*)"(?: as "(?<id>[^"]*)")?`, (w, g) =>
  capture(w, () => c(w).admin.createGrant({ organizationId: g.org!, privilege: g.priv!, amount: Number(g.amount), ...(g.id ? { id: g.id } : {}) }, { actor: "support", reason: "pack" })),
);
step("When", String.raw`I create a fixed provider configured with (?<raw>\{.*\})`, (w, g) => capture(w, () => new FixedProvider(w.catalog, fixedValues(g.raw!))));

// ---------------------------------------------------------------- When: evaluation

step("When", String.raw`I resolve "(?<priv>[^"]*)" for ${SCOPE}(?: at "(?<at>[^"]+)")?`, async (w, g) => {
  w.details = await c(w).getDetails(g.priv!, ctxOf(g.scope!, g.at));
});
step("When", String.raw`I read the limit of "(?<priv>[^"]*)" for ${SCOPE}`, async (w, g) => {
  w.details = await c(w).getLimitDetails(g.priv!, ctxOf(g.scope!));
});
step("When", String.raw`I read the option of "(?<priv>[^"]*)" for ${SCOPE}`, async (w, g) => {
  w.details = await c(w).getEnumDetails(g.priv!, ctxOf(g.scope!));
});
step("When", String.raw`I check feature "(?<feature>[^"]*)" for ${SCOPE}`, async (w, g) => {
  w.details = await c(w).isEnabledDetails(g.feature!, ctxOf(g.scope!));
});
step("When", String.raw`I require feature "(?<feature>[^"]*)" for ${SCOPE}`, async (w, g) => {
  w.checkRan = true;
  w.details = (await capture(w, () => c(w).requireEnabled(g.feature!, ctxOf(g.scope!)))) as ResolutionDetails | undefined;
});
step("When", String.raw`I require (?<req>-?\d+) more "(?<priv>[^"]*)" with current (?<cur>-?\d+) for ${SCOPE}`, async (w, g) => {
  w.checkRan = true;
  w.details = (await capture(w, () => c(w).requireWithin(g.priv!, Number(g.cur), Number(g.req), ctxOf(g.scope!)))) as ResolutionDetails | undefined;
});
step("When", String.raw`I require (?<req>-?\d+) more "(?<priv>[^"]*)" with pool usage (?<pool>\d+) and subject usage (?<sub>\d+) for ${SCOPE}`, async (w, g) => {
  w.checkRan = true;
  w.details = (await capture(w, () => c(w).requireWithin(g.priv!, { pool: Number(g.pool), subject: Number(g.sub) }, Number(g.req), ctxOf(g.scope!)))) as
    | ResolutionDetails
    | undefined;
});
step("When", String.raw`I compute the pool usage of (?<usage>\{.*?\}) with allowances (?<allow>\{.*?\})(?: and (?<un>\d+) unattributed)?`, (w, g) => {
  w.pool = poolUsage(JSON.parse(g.usage!), JSON.parse(g.allow!), Number(g.un ?? 0));
});
step("When", String.raw`(?<n>\d+) concurrent guarded requests each add (?<k>\d+) "(?<priv>[^"]*)" for organization "(?<org>[^"]*)"`, async (w, g) => {
  const counter = await w.target.counter(g.org!);
  w.counter = counter;
  const results = await Promise.all(
    Array.from({ length: Number(g.n) }, async () => {
      try {
        return await c(w).guard(g.priv!, Number(g.k), { organizationId: g.org! }, { count: (tx) => counter.count(tx), act: (tx) => counter.increment(tx) });
      } catch (e) {
        if (e instanceof EntitlementLimitExceeded) return null;
        throw e;
      }
    }),
  );
  w.guardResults = results;
});

// ---------------------------------------------------------------- Then

const enc = (v: unknown) => json(v);
const d = (w: World) => {
  assert.ok(w.details, "nothing was resolved");
  return w.details;
};

step("Then", `the value is ${VALUE}`, (w, g) => {
  const expected = parseValue(g.value!);
  assert.deepEqual(enc(d(w).value), enc(expected), JSON.stringify(detailsToJSON(d(w))));
  assert.equal(typeof d(w).value, typeof expected);
});
step("Then", "there is no value", (w) => assert.equal(d(w).value, null, JSON.stringify(detailsToJSON(d(w)))));
step("Then", String.raw`the reason is "(?<reason>[A-Z_]+)"`, (w, g) => assert.equal(d(w).reason, g.reason, JSON.stringify(detailsToJSON(d(w)))));
step("Then", `the plan value is ${VALUE}`, (w, g) => {
  assert.ok("planValue" in d(w), JSON.stringify(detailsToJSON(d(w))));
  assert.deepEqual(enc(d(w).planValue), enc(parseValue(g.value!)));
});
step("Then", "there is no plan value", (w) => assert.ok(!("planValue" in d(w)), JSON.stringify(detailsToJSON(d(w)))));
step("Then", String.raw`the override is "(?<id>[^"]*)"`, (w, g) => assert.equal(d(w).overrideId, g.id, JSON.stringify(detailsToJSON(d(w)))));
step("Then", "no override applies", (w) => assert.equal(d(w).overrideId, undefined));
const ids = (s: string) => s.split(",").map((x) => x.trim()).sort();
step("Then", String.raw`the grants are "(?<ids>[^"]*)"`, (w, g) => assert.deepEqual(d(w).grants.map((x) => x.id).sort(), ids(g.ids!)));
step("Then", "no grants apply", (w) => assert.deepEqual(d(w).grants, []));
step("Then", String.raw`the stale overrides are "(?<ids>[^"]*)"`, (w, g) => assert.deepEqual([...d(w).staleOverrides].sort(), ids(g.ids!)));
step("Then", "there are no stale overrides", (w) => assert.deepEqual(d(w).staleOverrides, []));
step("Then", String.raw`the error code is "(?<code>[A-Z_]+)"`, (w, g) => assert.equal(d(w).errorCode, g.code, JSON.stringify(detailsToJSON(d(w)))));
const requiredPlanOf = (w: World) => (w.denial ? w.denial.requiredPlan : w.details?.requiredPlan);
step("Then", String.raw`the required plan is "(?<plan>[^"]*)"`, (w, g) => {
  assert.equal(requiredPlanOf(w), g.plan);
  if (w.denial) assert.equal(w.denial.details.requiredPlan, g.plan);
});
step("Then", "there is no required plan", (w) => assert.equal(requiredPlanOf(w), undefined));
step("Then", "the check passes", (w) => assert.ok(w.checkRan && !w.denial && w.error === undefined, `denied: ${w.denial?.message} / error: ${String(w.error)}`));
step("Then", "the check fails", (w) => assert.ok(w.denial, `expected a denial (error: ${String(w.error)})`));
step("Then", String.raw`the denial code is "(?<code>[a-z_]+)"`, (w, g) => assert.equal(w.denial?.code, g.code));
step("Then", String.raw`the denial reports limit ${VALUE}, current (?<cur>\d+) and requested (?<req>-?\d+)`, (w, g) => {
  const e = w.denial as EntitlementLimitExceeded;
  assert.ok(e instanceof EntitlementLimitExceeded);
  assert.deepEqual(enc(e.limit), enc(parseValue(g.value!)));
  assert.equal(e.current, Number(g.cur));
  assert.equal(e.requested, Number(g.req));
});
step("Then", String.raw`the operation fails with "(?<code>[A-Za-z_]+)"`, (w, g) => {
  assert.ok(w.error !== undefined, "expected the operation to fail");
  assert.equal(codeOf(w.error), g.code, String(w.error));
  w.errorConsumed = true;
});
step("Then", "the operation succeeds", (w) => assert.equal(w.error, undefined));
step("Then", String.raw`an audit event records (?<action>\w+) of (?<entity>\w+) "(?<id>[^"]*)"`, (w, g) => {
  const m = w.audit.events.filter((e) => e.action === g.action && e.entity === g.entity && e.entityId === g.id);
  assert.ok(m.length > 0, `no ${g.action} ${g.entity} ${g.id}: ${JSON.stringify(w.audit.events.map(auditEventToJSON))}`);
  w.event = m.at(-1);
});
const ev = (w: World) => auditEventToJSON(w.event!) as Record<string, any>;
step("Then", String.raw`its (?<which>before|after) is (?<raw>.+)`, (w, g) => assert.deepEqual(ev(w)[g.which!], JSON.parse(g.raw!)));
step("Then", String.raw`its (?<which>before|after) includes (?<raw>\{.+\})`, (w, g) => {
  const got = ev(w)[g.which!];
  for (const [k, v] of Object.entries(JSON.parse(g.raw!))) assert.deepEqual(got?.[k], v, JSON.stringify(got));
});
step("Then", String.raw`its after marks it revoked at "(?<at>[^"]+)"`, (w, g) => assert.equal(new Date(ev(w).after.revokedAt).getTime(), ts(g.at!).getTime()));
step("Then", String.raw`its (?<field>actor|reason) is "(?<v>[^"]*)"`, (w, g) => assert.equal((w.event as any)[g.field!], g.v));
step("Then", String.raw`its time is "(?<at>[^"]+)"`, (w, g) => assert.equal(w.event!.at.getTime(), ts(g.at!).getTime()));
step("Then", "no audit event was recorded", (w) => assert.deepEqual(w.audit.events, []));
step("Then", String.raw`the pool usage is (?<n>\d+)`, (w, g) => assert.equal(w.pool, Number(g.n)));
step("Then", String.raw`exactly (?<n>\d+) succeed`, (w, g) => assert.equal(w.guardResults.filter((r) => r !== null).length, Number(g.n)));
step("Then", String.raw`the usage counter is (?<n>\d+)`, async (w, g) => assert.equal(await w.counter!.value(), Number(g.n)));
step("Then", "the lock domain is reported", (w) => assert.ok(w.guardResults.find((r) => r !== null)?.details.lockDomain));
step("Then", String.raw`the details encode the value as (?<raw>.+)`, (w, g) => assert.deepEqual(json(detailsToJSON(d(w))).value, JSON.parse(g.raw!)));
step("Then", String.raw`the HTTP status is (?<status>\d+)`, (w, g) => assert.equal(toHttpProblem(w.denial!).status, Number(g.status)));
step("Then", String.raw`the HTTP problem includes (?<raw>\{.+\})`, (w, g) => {
  const body = json(toHttpProblem(w.denial!).body);
  for (const [k, v] of Object.entries(JSON.parse(g.raw!))) assert.deepEqual(body[k], v, JSON.stringify(body));
});
step("Then", String.raw`the HTTP problem has no "(?<key>[^"]+)"`, (w, g) => assert.ok(!(g.key! in toHttpProblem(w.denial!).body)));

export async function runStep(w: World, keyword: string, text: string): Promise<void> {
  if (keyword === "When" && !w.whenStarted) {
    w.whenStarted = true;
    w.audit.events.length = 0;
  }
  if (keyword === "When") {
    w.denial = undefined;
    w.checkRan = false;
  }
  for (const s of STEPS) {
    if (s.kw !== keyword) continue;
    const m = s.re.exec(text);
    if (m) {
      await s.fn(w, m.groups ?? {});
      return;
    }
  }
  throw new Error(`undefined step: ${keyword} ${text}`);
}
