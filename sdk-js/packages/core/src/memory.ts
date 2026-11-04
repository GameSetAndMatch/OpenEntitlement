/** The in-memory reference provider: full capabilities, no persistence. */

import { isUnlimited } from "./values.ts";
import type { PrivilegeDefinition } from "./catalog.ts";
import { InvalidArgument, NotFound } from "./errors.ts";
import {
  assignmentToJSON,
  grantToJSON,
  overrideToJSON,
  planFamily,
  planToJSON,
  type Assignment,
  type FactSource,
  type Grant,
  type Override,
  type Plan,
} from "./facts.ts";
import {
  assertNoOverrideConflict,
  assertReason,
  assertValidGrant,
  assertValidInterval,
  assertValidScope,
  assertValidValue,
  FactsProvider,
  newId,
  type AuditEvent,
  type AuditFilter,
  type Capabilities,
  type Inspection,
  type PlanWithValues,
  type GrantInput,
  type MutationMeta,
  type Mutations,
  type OverrideInput,
} from "./provider.ts";

/** Detach mutable records while preserving the UNLIMITED singleton and Date values. */
function snapshot<T>(value: T): T {
  if (isUnlimited(value)) return value;
  if (value instanceof Date) return new Date(value.getTime()) as T;
  if (Array.isArray(value)) return value.map(snapshot) as T;
  if (value !== null && typeof value === "object")
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, snapshot(item)])) as T;
  return value;
}

class Store implements FactSource {
  plansById = new Map<string, Plan>();
  values = new Map<string, unknown>();
  assignments = new Map<string, Assignment>();
  overridesById = new Map<string, Override>();
  grantsById = new Map<string, Grant>();

  async assignment(org: string) {
    return this.assignments.get(org);
  }
  async plan(id: string) {
    return this.plansById.get(id);
  }
  async plans() {
    return [...this.plansById.values()];
  }
  async planValue(planId: string, privilege: string) {
    const k = `${planId}\u0000${privilege}`;
    return this.values.has(k) ? { found: true, value: this.values.get(k) } : { found: false };
  }
  async overrides(org: string, privilege: string) {
    return this.overridesSync(org, privilege);
  }
  overridesSync(org: string, privilege: string) {
    return [...this.overridesById.values()].filter((o) => o.scope.organizationId === org && o.privilege === privilege);
  }
  async grants(org: string, privilege: string) {
    return [...this.grantsById.values()].filter((g) => g.scope.organizationId === org && g.privilege === privilege);
  }
}

export interface InMemorySeed {
  plans?: Plan[];
  /** planId -> privilegeKey -> value. Not validated: use the admin API for validated writes. */
  values?: Record<string, Record<string, unknown>>;
  /** organizationId -> planId */
  assignments?: Record<string, string>;
}

/**
 * Reference provider. Seed it directly for quick setups (seeding bypasses audit: it is configuration, not change):
 *
 *   new InMemoryProvider({ plans: [{ id: "pro", name: "Pro", rank: 1 }], values: { pro: { "seats.max": 50 } }, assignments: { acme: "pro" } })
 */
export class InMemoryProvider extends FactsProvider {
  readonly metadata = { name: "in-memory" };
  readonly capabilities: Capabilities = { overrides: true, grants: true, mutations: true, planCatalog: true, fixed: false, inspection: true };
  readonly mutations: Mutations;
  readonly inspection: Inspection;
  readonly #store = new Store();

  constructor(seed: InMemorySeed = {}) {
    super();
    for (const p of seed.plans ?? []) this.#store.plansById.set(p.id, p);
    for (const [planId, vals] of Object.entries(seed.values ?? {}))
      for (const [k, v] of Object.entries(vals)) this.#store.values.set(`${planId}\u0000${k}`, v);
    for (const [org, planId] of Object.entries(seed.assignments ?? {})) this.#store.assignments.set(org, { organizationId: org, planId });
    const audit: AuditEvent[] = [];
    const inner = new MemoryMutations(this.#store);
    // record every successful mutation so Inspection.listAudit works without a database
    this.mutations = new Proxy(inner, {
      get(target, prop, receiver) {
        const v = Reflect.get(target, prop, receiver);
        if (typeof v !== "function") return v;
        return async (...args: unknown[]) => {
          const e = (await v.apply(target, args)) as AuditEvent;
          audit.push(snapshot(e));
          return e;
        };
      },
    });
    const s = this.#store;
    this.inspection = {
      async listPlans(): Promise<PlanWithValues[]> {
        return [...s.plansById.values()].map((p) => {
          const values: Record<string, unknown> = {};
          for (const [k, v] of s.values) {
            const [planId, key] = k.split("\u0000");
            if (planId === p.id) values[key!] = v;
          }
          return { ...p, values };
        });
      },
      async listAssignments() {
        return snapshot([...s.assignments.values()]);
      },
      async listOverrides(org: string) {
        return snapshot([...s.overridesById.values()].filter((o) => o.scope.organizationId === org));
      },
      async listGrants(org: string) {
        return snapshot([...s.grantsById.values()].filter((g) => g.scope.organizationId === org));
      },
      async listAudit(f: AuditFilter = {}) {
        return audit
          .filter((e) => (f.entity === undefined || e.entity === f.entity) && (f.entityId === undefined || e.entityId === f.entityId))
          .reverse()
          .slice(0, f.limit ?? 200).map(snapshot);
      },
    };
  }

  protected facts(): FactSource {
    return this.#store;
  }
}

class MemoryMutations implements Mutations {
  readonly #s: Store;
  constructor(store: Store) {
    this.#s = store;
  }

  async upsertPlan(plan: Plan, meta: MutationMeta, at: Date): Promise<AuditEvent> {
    if (!plan.id || !plan.name) throw new InvalidArgument("plan needs an id and a name");
    if (plan.variantOf !== undefined) {
      if (plan.variantOf === plan.id || [...this.#s.plansById.values()].some((p) => p.variantOf === plan.id))
        throw new InvalidArgument("a base plan with variants cannot become a variant (Requirement 1.3.2)");
      const base = this.#s.plansById.get(plan.variantOf);
      if (!base) throw new NotFound(`plan "${plan.variantOf}" (variantOf) not found`);
      if (base.variantOf !== undefined) throw new InvalidArgument("variantOf must not chain (Requirement 1.3.2)");
    }
    const before = this.#s.plansById.get(plan.id);
    this.#s.plansById.set(plan.id, { ...plan });
    return { ...meta, entity: "plan", entityId: plan.id, action: before ? "update" : "create", before: before ? planToJSON(before) : null, after: planToJSON(plan), at };
  }

  async setPlanValue(planId: string, privilege: PrivilegeDefinition, value: unknown, meta: MutationMeta, at: Date): Promise<AuditEvent> {
    if (!this.#s.plansById.has(planId)) throw new NotFound(`plan "${planId}" not found`);
    assertValidValue(privilege, value);
    const k = `${planId}\u0000${privilege.key}`;
    const existed = this.#s.values.has(k);
    const before = this.#s.values.get(k);
    this.#s.values.set(k, value);
    return { ...meta, entity: "planValue", entityId: `${planId}:${privilege.key}`, action: existed ? "update" : "create", before: existed ? before : null, after: value, at };
  }

  async assignPlan(organizationId: string, planId: string | null, channel: string | undefined, meta: MutationMeta, at: Date): Promise<AuditEvent> {
    if (!organizationId) throw new InvalidArgument("organizationId is required");
    const before = this.#s.assignments.get(organizationId);
    if (planId === null) {
      if (!before) throw new NotFound(`organization "${organizationId}" has no plan`);
      this.#s.assignments.delete(organizationId);
      return { ...meta, entity: "assignment", entityId: organizationId, action: "delete", before: assignmentToJSON(before), after: null, at };
    }
    if (!this.#s.plansById.has(planId)) throw new NotFound(`plan "${planId}" not found`);
    const after: Assignment = channel !== undefined ? { organizationId, planId, channel } : { organizationId, planId };
    this.#s.assignments.set(organizationId, after);
    return {
      ...meta,
      entity: "assignment",
      entityId: organizationId,
      action: before ? "update" : "create",
      before: before ? assignmentToJSON(before) : null,
      after: assignmentToJSON(after),
      at,
    };
  }

  async createOverride(input: OverrideInput, privilege: PrivilegeDefinition, meta: MutationMeta, at: Date): Promise<AuditEvent> {
    assertValidScope(input.scope, true);
    assertValidValue(privilege, input.value);
    assertValidInterval(input.startsAt, input.expiresAt);
    assertReason(input.reason, "an override");
    let family = input.planFamily;
    if (family === undefined) {
      const a = this.#s.assignments.get(input.scope.organizationId);
      const plan = a ? this.#s.plansById.get(a.planId) : undefined;
      if (!plan) throw new InvalidArgument("organization has no plan; pass planFamily explicitly (Requirement 1.5.3)");
      family = planFamily(plan);
    }
    assertNoOverrideConflict(input, this.#s.overridesSync(input.scope.organizationId, input.privilege));
    const id = input.id ?? newId("ovr");
    if (this.#s.overridesById.has(id)) throw new InvalidArgument(`override id "${id}" already exists`);
    const o: Override = { id, scope: { ...input.scope }, privilege: input.privilege, value: input.value, planFamily: family, reason: input.reason, createdBy: meta.actor };
    if (input.startsAt) o.startsAt = input.startsAt;
    if (input.expiresAt) o.expiresAt = input.expiresAt;
    this.#s.overridesById.set(id, o);
    return { ...meta, entity: "override", entityId: id, action: "create", before: null, after: overrideToJSON(o), at };
  }

  async deleteOverride(overrideId: string, meta: MutationMeta, at: Date): Promise<AuditEvent> {
    const o = this.#s.overridesById.get(overrideId);
    if (!o) throw new NotFound(`override "${overrideId}" not found`);
    this.#s.overridesById.delete(overrideId);
    return { ...meta, entity: "override", entityId: overrideId, action: "delete", before: overrideToJSON(o), after: null, at };
  }

  async createGrant(input: GrantInput, privilege: PrivilegeDefinition, meta: MutationMeta, at: Date): Promise<AuditEvent> {
    assertValidScope(input.scope, false);
    assertValidGrant(privilege, input);
    assertValidInterval(input.startsAt, input.expiresAt);
    assertReason(input.reason, "a grant");
    const id = input.id ?? newId("grt");
    if (this.#s.grantsById.has(id)) throw new InvalidArgument(`grant id "${id}" already exists`);
    const g: Grant = { id, scope: { ...input.scope }, privilege: input.privilege, amount: input.amount, reason: input.reason, createdBy: meta.actor };
    if (input.startsAt) g.startsAt = input.startsAt;
    if (input.expiresAt) g.expiresAt = input.expiresAt;
    this.#s.grantsById.set(id, g);
    return { ...meta, entity: "grant", entityId: id, action: "create", before: null, after: grantToJSON(g), at };
  }

  async revokeGrant(grantId: string, meta: MutationMeta, at: Date): Promise<AuditEvent> {
    const g = this.#s.grantsById.get(grantId);
    if (!g || g.revokedAt) throw new NotFound(`active grant "${grantId}" not found`);
    const revoked = { ...g, revokedAt: at };
    this.#s.grantsById.set(grantId, revoked);
    return { ...meta, entity: "grant", entityId: grantId, action: "revoke", before: grantToJSON(g), after: grantToJSON(revoked), at };
  }
}
