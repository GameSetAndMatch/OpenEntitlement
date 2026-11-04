/** Postgres provider and advisory lock for OpenEntitlement (node-postgres). Same schema as the Python provider. */

import { readFile } from "node:fs/promises";
import type { Pool, PoolClient } from "pg";
import {
  assertNoOverrideConflict,
  assertReason,
  assertValidGrant,
  assertValidInterval,
  assertValidScope,
  assertValidValue,
  assignmentToJSON,
  decodeValue,
  encodeJson,
  encodeValue,
  FactsProvider,
  grantToJSON,
  InvalidArgument,
  newId,
  NotFound,
  overrideToJSON,
  planFamily,
  planToJSON,
  type Assignment,
  type AuditEvent,
  type AuditFilter,
  type Capabilities,
  type Inspection,
  type PlanWithValues,
  type FactSource,
  type Grant,
  type GrantInput,
  type Lock,
  type MutationMeta,
  type Mutations,
  type Override,
  type OverrideInput,
  type Plan,
  type PrivilegeDefinition,
  type ResolutionDetails,
  type ResolvedContext,
  resolveFromFacts,
  suggestPlanFromFacts,
  type Need,
} from "@openentitlement/core";

export async function schemaSql(): Promise<string> {
  return readFile(new URL("../schema.sql", import.meta.url), "utf8");
}

/** Create the oe_* tables if they don't exist. */
export async function migrate(pool: Pool): Promise<void> {
  await pool.query(await schemaSql());
}

type Q = Pick<PoolClient, "query">;

const toDate = (v: unknown): Date | undefined => (v === null || v === undefined ? undefined : v instanceof Date ? v : new Date(String(v)));
const jsonb = (v: unknown) => JSON.stringify(encodeValue(v));

function rowPlan(r: any): Plan {
  const p: Plan = { id: r.id, name: r.name };
  if (r.rank !== null) p.rank = r.rank;
  if (r.public === false) p.public = false;
  if (r.variant_of !== null) p.variantOf = r.variant_of;
  return p;
}

function rowOverride(r: any): Override {
  const o: Override = {
    id: r.id,
    scope: { organizationId: r.organization_id },
    privilege: r.privilege,
    value: decodeValue(r.value),
    planFamily: r.plan_family,
    reason: r.reason,
    createdBy: r.created_by,
  };
  if (r.subject_id !== null) o.scope.subjectId = r.subject_id;
  if (r.resource_id !== null) o.scope.resourceId = r.resource_id;
  const s = toDate(r.starts_at), e = toDate(r.expires_at);
  if (s) o.startsAt = s;
  if (e) o.expiresAt = e;
  return o;
}

function rowGrant(r: any): Grant {
  const g: Grant = { id: r.id, scope: { organizationId: r.organization_id }, privilege: r.privilege, amount: Number(r.amount), reason: r.reason, createdBy: r.created_by };
  if (r.subject_id !== null) g.scope.subjectId = r.subject_id;
  const s = toDate(r.starts_at), e = toDate(r.expires_at), v = toDate(r.revoked_at);
  if (s) g.startsAt = s;
  if (e) g.expiresAt = e;
  if (v) g.revokedAt = v;
  return g;
}

const OVERRIDE_COLS = "id, organization_id, subject_id, resource_id, privilege, value, plan_family, reason, starts_at, expires_at, created_by";
const GRANT_COLS = "id, organization_id, subject_id, privilege, amount, reason, starts_at, expires_at, revoked_at, created_by";

class Facts implements FactSource {
  readonly #q: Q;
  constructor(q: Q) {
    this.#q = q;
  }
  async assignment(org: string): Promise<Assignment | undefined> {
    const { rows } = await this.#q.query("select organization_id, plan_id, channel from oe_assignment where organization_id = $1", [org]);
    const r = rows[0];
    if (!r) return undefined;
    const a: Assignment = { organizationId: r.organization_id, planId: r.plan_id };
    if (r.channel !== null) a.channel = r.channel;
    return a;
  }
  async plan(id: string) {
    const { rows } = await this.#q.query("select id, name, rank, public, variant_of from oe_plan where id = $1", [id]);
    return rows[0] ? rowPlan(rows[0]) : undefined;
  }
  async plans() {
    return (await this.#q.query("select id, name, rank, public, variant_of from oe_plan")).rows.map(rowPlan);
  }
  async planValue(planId: string, privilege: string) {
    const { rows } = await this.#q.query("select value from oe_plan_value where plan_id = $1 and privilege = $2", [planId, privilege]);
    return rows[0] ? { found: true, value: decodeValue(rows[0].value) } : { found: false };
  }
  async overrides(org: string, privilege: string) {
    return (await this.#q.query(`select ${OVERRIDE_COLS} from oe_override where organization_id = $1 and privilege = $2`, [org, privilege])).rows.map(rowOverride);
  }
  async grants(org: string, privilege: string) {
    return (await this.#q.query(`select ${GRANT_COLS} from oe_grant where organization_id = $1 and privilege = $2`, [org, privilege])).rows.map(rowGrant);
  }
}

async function inTransaction<R>(pool: Pool, fn: (c: PoolClient) => Promise<R>, isolation?: string): Promise<R> {
  const c = await pool.connect();
  try {
    await c.query(isolation ? `begin isolation level ${isolation}` : "begin");
    const r = await fn(c);
    await c.query("commit");
    return r;
  } catch (e) {
    await c.query("rollback").catch(() => undefined);
    throw e;
  } finally {
    c.release();
  }
}

/** Reference Postgres provider. Full capabilities; durable audit in `oe_audit`. */
export class PostgresProvider extends FactsProvider {
  readonly metadata = { name: "postgres" };
  readonly capabilities: Capabilities = { overrides: true, grants: true, mutations: true, planCatalog: true, fixed: false, inspection: true };
  readonly mutations: Mutations;
  readonly inspection: Inspection;
  readonly #pool: Pool;
  readonly #autoMigrate: boolean;

  constructor(opts: { pool: Pool; autoMigrate?: boolean }) {
    super();
    this.#pool = opts.pool;
    this.#autoMigrate = opts.autoMigrate ?? false;
    this.mutations = new PgMutations(opts.pool);
    this.inspection = new PgInspection(opts.pool);
  }

  async initialize(): Promise<void> {
    if (this.#autoMigrate) await migrate(this.#pool);
    else await this.#pool.query("select 1 from oe_plan limit 1");
  }

  protected facts(): FactSource {
    return new Facts(this.#pool);
  }

  /** One repeatable-read snapshot for the whole resolution. */
  override resolve(privilege: PrivilegeDefinition, ctx: ResolvedContext): Promise<ResolutionDetails> {
    return inTransaction(this.#pool, (c) => resolveFromFacts(new Facts(c), privilege, ctx), "repeatable read");
  }

  override suggestPlan(privilege: PrivilegeDefinition, need: Need, ctx: ResolvedContext): Promise<string | undefined> {
    return suggestPlanFromFacts(new Facts(this.#pool), privilege, need, ctx);
  }
}

class PgMutations implements Mutations {
  readonly #pool: Pool;
  constructor(pool: Pool) {
    this.#pool = pool;
  }

  #tx(fn: (c: PoolClient) => Promise<AuditEvent>): Promise<AuditEvent> {
    return inTransaction(this.#pool, async (c) => {
      const e = await fn(c);
      await c.query(
        "insert into oe_audit (at, actor, reason, entity, entity_id, action, before, after) values ($1, $2, $3, $4, $5, $6, $7, $8)",
        [e.at, e.actor, e.reason, e.entity, e.entityId, e.action, e.before === null ? null : JSON.stringify(encodeJson(e.before)), e.after === null ? null : JSON.stringify(encodeJson(e.after))],
      );
      return e;
    });
  }

  upsertPlan(plan: Plan, meta: MutationMeta, at: Date) {
    if (!plan.id || !plan.name) throw new InvalidArgument("plan needs an id and a name");
    return this.#tx(async (c) => {
      const f = new Facts(c);
      if (plan.variantOf !== undefined) {
        const base = await f.plan(plan.variantOf);
        if (!base) throw new NotFound(`plan "${plan.variantOf}" (variantOf) not found`);
        if (base.variantOf !== undefined) throw new InvalidArgument("variantOf must not chain (Requirement 1.3.2)");
      }
      const before = await f.plan(plan.id);
      await c.query(
        "insert into oe_plan (id, name, rank, public, variant_of) values ($1, $2, $3, $4, $5) on conflict (id) do update set name = excluded.name, rank = excluded.rank, public = excluded.public, variant_of = excluded.variant_of",
        [plan.id, plan.name, plan.rank ?? null, plan.public ?? true, plan.variantOf ?? null],
      );
      return { ...meta, entity: "plan", entityId: plan.id, action: before ? "update" : "create", before: before ? planToJSON(before) : null, after: planToJSON(plan), at } as AuditEvent;
    });
  }

  setPlanValue(planId: string, privilege: PrivilegeDefinition, value: unknown, meta: MutationMeta, at: Date) {
    assertValidValue(privilege, value);
    return this.#tx(async (c) => {
      if (!(await new Facts(c).plan(planId))) throw new NotFound(`plan "${planId}" not found`);
      const { rows } = await c.query("select value from oe_plan_value where plan_id = $1 and privilege = $2 for update", [planId, privilege.key]);
      await c.query(
        "insert into oe_plan_value (plan_id, privilege, value) values ($1, $2, $3) on conflict (plan_id, privilege) do update set value = excluded.value",
        [planId, privilege.key, jsonb(value)],
      );
      const r = rows[0];
      return { ...meta, entity: "planValue", entityId: `${planId}:${privilege.key}`, action: r ? "update" : "create", before: r ? decodeValue(r.value) : null, after: value, at } as AuditEvent;
    });
  }

  assignPlan(organizationId: string, planId: string | null, channel: string | undefined, meta: MutationMeta, at: Date) {
    if (!organizationId) throw new InvalidArgument("organizationId is required");
    return this.#tx(async (c) => {
      const { rows } = await c.query("select organization_id, plan_id, channel from oe_assignment where organization_id = $1 for update", [organizationId]);
      const r = rows[0];
      const before: Assignment | undefined = r ? { organizationId: r.organization_id, planId: r.plan_id, ...(r.channel !== null ? { channel: r.channel } : {}) } : undefined;
      if (planId === null) {
        if (!before) throw new NotFound(`organization "${organizationId}" has no plan`);
        await c.query("delete from oe_assignment where organization_id = $1", [organizationId]);
        return { ...meta, entity: "assignment", entityId: organizationId, action: "delete", before: assignmentToJSON(before), after: null, at } as AuditEvent;
      }
      if (!(await new Facts(c).plan(planId))) throw new NotFound(`plan "${planId}" not found`);
      await c.query(
        "insert into oe_assignment (organization_id, plan_id, channel, assigned_at) values ($1, $2, $3, $4) on conflict (organization_id) do update set plan_id = excluded.plan_id, channel = excluded.channel, assigned_at = excluded.assigned_at",
        [organizationId, planId, channel ?? null, at],
      );
      const after: Assignment = { organizationId, planId, ...(channel !== undefined ? { channel } : {}) };
      return { ...meta, entity: "assignment", entityId: organizationId, action: before ? "update" : "create", before: before ? assignmentToJSON(before) : null, after: assignmentToJSON(after), at } as AuditEvent;
    });
  }

  createOverride(input: OverrideInput, privilege: PrivilegeDefinition, meta: MutationMeta, at: Date) {
    assertValidScope(input.scope, true);
    assertValidValue(privilege, input.value);
    assertValidInterval(input.startsAt, input.expiresAt);
    assertReason(input.reason, "an override");
    return this.#tx(async (c) => {
      const org = input.scope.organizationId;
      // serialize override creation per (org, privilege) so the conflict check is race-free (Requirement 1.5.7)
      await c.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [`oe:override:${org}:${input.privilege}`]);
      const f = new Facts(c);
      let family = input.planFamily;
      if (family === undefined) {
        const a = await f.assignment(org);
        const plan = a ? await f.plan(a.planId) : undefined;
        if (!plan) throw new InvalidArgument("organization has no plan; pass planFamily explicitly (Requirement 1.5.3)");
        family = planFamily(plan);
      }
      assertNoOverrideConflict(input, await f.overrides(org, input.privilege));
      const id = input.id ?? newId("ovr");
      const o: Override = { id, scope: { ...input.scope }, privilege: input.privilege, value: input.value, planFamily: family, reason: input.reason, createdBy: meta.actor };
      if (input.startsAt) o.startsAt = input.startsAt;
      if (input.expiresAt) o.expiresAt = input.expiresAt;
      try {
        await c.query(
          "insert into oe_override (id, organization_id, subject_id, resource_id, privilege, value, plan_family, reason, starts_at, expires_at, created_by, created_at) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)",
          [id, org, input.scope.subjectId ?? null, input.scope.resourceId ?? null, input.privilege, jsonb(input.value), family, input.reason, input.startsAt ?? null, input.expiresAt ?? null, meta.actor, at],
        );
      } catch (e: any) {
        if (e?.code === "23505") throw new InvalidArgument(`override id "${id}" already exists`);
        throw e;
      }
      return { ...meta, entity: "override", entityId: id, action: "create", before: null, after: overrideToJSON(o), at } as AuditEvent;
    });
  }

  deleteOverride(overrideId: string, meta: MutationMeta, at: Date) {
    return this.#tx(async (c) => {
      const { rows } = await c.query(`delete from oe_override where id = $1 returning ${OVERRIDE_COLS}`, [overrideId]);
      if (!rows[0]) throw new NotFound(`override "${overrideId}" not found`);
      return { ...meta, entity: "override", entityId: overrideId, action: "delete", before: overrideToJSON(rowOverride(rows[0])), after: null, at } as AuditEvent;
    });
  }

  createGrant(input: GrantInput, privilege: PrivilegeDefinition, meta: MutationMeta, at: Date) {
    assertValidScope(input.scope, false);
    assertValidGrant(privilege, input);
    assertValidInterval(input.startsAt, input.expiresAt);
    assertReason(input.reason, "a grant");
    return this.#tx(async (c) => {
      const id = input.id ?? newId("grt");
      const g: Grant = { id, scope: { ...input.scope }, privilege: input.privilege, amount: input.amount, reason: input.reason, createdBy: meta.actor };
      if (input.startsAt) g.startsAt = input.startsAt;
      if (input.expiresAt) g.expiresAt = input.expiresAt;
      try {
        await c.query(
          "insert into oe_grant (id, organization_id, subject_id, privilege, amount, reason, starts_at, expires_at, created_by, created_at) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)",
          [id, input.scope.organizationId, input.scope.subjectId ?? null, input.privilege, input.amount, input.reason, input.startsAt ?? null, input.expiresAt ?? null, meta.actor, at],
        );
      } catch (e: any) {
        if (e?.code === "23505") throw new InvalidArgument(`grant id "${id}" already exists`);
        throw e;
      }
      return { ...meta, entity: "grant", entityId: id, action: "create", before: null, after: grantToJSON(g), at } as AuditEvent;
    });
  }

  revokeGrant(grantId: string, meta: MutationMeta, at: Date) {
    return this.#tx(async (c) => {
      const { rows } = await c.query(`select ${GRANT_COLS} from oe_grant where id = $1 and revoked_at is null for update`, [grantId]);
      if (!rows[0]) throw new NotFound(`active grant "${grantId}" not found`);
      await c.query("update oe_grant set revoked_at = $1 where id = $2", [at, grantId]);
      const before = rowGrant(rows[0]);
      return { ...meta, entity: "grant", entityId: grantId, action: "revoke", before: grantToJSON(before), after: grantToJSON({ ...before, revokedAt: at }), at } as AuditEvent;
    });
  }
}

class PgInspection implements Inspection {
  readonly #pool: Pool;
  constructor(pool: Pool) {
    this.#pool = pool;
  }
  async listPlans(): Promise<PlanWithValues[]> {
    const plans = (await this.#pool.query("select id, name, rank, public, variant_of from oe_plan order by rank nulls last, id")).rows.map(rowPlan);
    const { rows } = await this.#pool.query("select plan_id, privilege, value from oe_plan_value");
    return plans.map((p) => ({
      ...p,
      values: Object.fromEntries(rows.filter((r) => r.plan_id === p.id).map((r) => [r.privilege, decodeValue(r.value)])),
    }));
  }
  async listAssignments(): Promise<Assignment[]> {
    const { rows } = await this.#pool.query("select organization_id, plan_id, channel from oe_assignment order by organization_id");
    return rows.map((r) => ({ organizationId: r.organization_id, planId: r.plan_id, ...(r.channel !== null ? { channel: r.channel } : {}) }));
  }
  async listOverrides(org: string): Promise<Override[]> {
    return (await this.#pool.query(`select ${OVERRIDE_COLS} from oe_override where organization_id = $1 order by created_at`, [org])).rows.map(rowOverride);
  }
  async listGrants(org: string): Promise<Grant[]> {
    return (await this.#pool.query(`select ${GRANT_COLS} from oe_grant where organization_id = $1 order by created_at`, [org])).rows.map(rowGrant);
  }
  async listAudit(f: AuditFilter = {}): Promise<AuditEvent[]> {
    const { rows } = await this.#pool.query(
      "select at, actor, reason, entity, entity_id, action, before, after from oe_audit where ($1::text is null or entity = $1) and ($2::text is null or entity_id = $2) order by id desc limit $3",
      [f.entity ?? null, f.entityId ?? null, f.limit ?? 200],
    );
    return rows.map((r) => ({ at: toDate(r.at)!, actor: r.actor, reason: r.reason, entity: r.entity, entityId: r.entity_id, action: r.action, before: r.before, after: r.after }));
  }
}

/**
 * Transactional lock for `guard` (spec §5.4). `count` and `act` receive the PoolClient; both run in
 * ONE transaction holding pg_advisory_xact_lock, committed after `act` succeeds, rolled back otherwise.
 */
export class PostgresAdvisoryLock implements Lock<PoolClient> {
  readonly domain = "database";
  readonly #pool: Pool;
  constructor(opts: { pool: Pool }) {
    this.#pool = opts.pool;
  }
  run<R>(key: string, fn: (tx: PoolClient) => Promise<R>): Promise<R> {
    return inTransaction(this.#pool, async (c) => {
      await c.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [key]);
      return fn(c);
    });
  }
}

