/** The provider interface (spec §6) and mutation types (spec §6.3, §7.3). */

import { validateValue, type PrivilegeDefinition } from "./catalog.ts";
import type { ResolutionDetails, ResolvedContext } from "./details.ts";
import { Conflict, InvalidArgument, InvalidValue } from "./errors.ts";
import { intervalsOverlap, type Assignment, type FactSource, type Grant, type Override, type Plan, type Scope } from "./facts.ts";
import { resolveFromFacts, suggestPlanFromFacts, type Need } from "./resolver.ts";
import { encodeJson, isInt } from "./values.ts";

export interface ProviderMetadata {
  readonly name: string;
}

/** Requirement 6.1.3. */
export interface Capabilities {
  readonly overrides: boolean;
  readonly grants: boolean;
  readonly mutations: boolean;
  readonly planCatalog: boolean;
  readonly fixed: boolean;
  /** Optional (spec §6.6): the provider implements the read-only `Inspection` interface. */
  readonly inspection?: boolean;
}

export const NO_CAPABILITIES: Capabilities = Object.freeze({ overrides: false, grants: false, mutations: false, planCatalog: false, fixed: false });

/** Conformance tags a provider must pass. */
export function capabilityTags(c: Capabilities): Set<string> {
  const tags = new Set<string>();
  if (c.overrides) tags.add("overrides");
  if (c.grants) tags.add("grants");
  if (c.mutations) tags.add("mutations");
  if (c.planCatalog) tags.add("plan-catalog");
  if (c.fixed) tags.add("fixed");
  if (c.inspection) tags.add("inspection");
  return tags;
}

export interface MutationMeta {
  actor: string;
  reason: string;
}

/** Requirement 7.3.1. */
export interface AuditEvent {
  actor: string;
  reason: string;
  entity: "plan" | "planValue" | "assignment" | "override" | "grant";
  entityId: string;
  action: "create" | "update" | "delete" | "revoke";
  before: unknown;
  after: unknown;
  at: Date;
}

export function auditEventToJSON(e: AuditEvent): Record<string, unknown> {
  return { ...e, before: encodeJson(e.before) ?? null, after: encodeJson(e.after) ?? null, at: e.at.toISOString() };
}

export interface OverrideInput {
  scope: Scope;
  privilege: string;
  value: unknown;
  reason: string;
  startsAt?: Date;
  expiresAt?: Date;
  planFamily?: string;
  id?: string;
}

export interface GrantInput {
  scope: Omit<Scope, "resourceId">;
  privilege: string;
  amount: number;
  reason: string;
  startsAt?: Date;
  expiresAt?: Date;
  id?: string;
}

/** Requirement 6.3.1. `at` comes from the client clock; `meta` is already checked. */
export interface Mutations {
  upsertPlan(plan: Plan, meta: MutationMeta, at: Date): Promise<AuditEvent>;
  setPlanValue(planId: string, privilege: PrivilegeDefinition, value: unknown, meta: MutationMeta, at: Date): Promise<AuditEvent>;
  assignPlan(organizationId: string, planId: string | null, channel: string | undefined, meta: MutationMeta, at: Date): Promise<AuditEvent>;
  createOverride(input: OverrideInput, privilege: PrivilegeDefinition, meta: MutationMeta, at: Date): Promise<AuditEvent>;
  deleteOverride(overrideId: string, meta: MutationMeta, at: Date): Promise<AuditEvent>;
  createGrant(input: GrantInput, privilege: PrivilegeDefinition, meta: MutationMeta, at: Date): Promise<AuditEvent>;
  revokeGrant(grantId: string, meta: MutationMeta, at: Date): Promise<AuditEvent>;
}

export interface PlanWithValues extends Plan {
  /** privilegeKey -> value, only for values the plan sets. */
  values: Record<string, unknown>;
}

export interface AuditFilter {
  entity?: AuditEvent["entity"];
  entityId?: string;
  limit?: number;
}

/** Spec §6.6 (optional): read-only listing for admin consoles. Never used by resolution. */
export interface Inspection {
  listPlans(): Promise<PlanWithValues[]>;
  listAssignments(): Promise<Assignment[]>;
  listOverrides(organizationId: string): Promise<Override[]>;
  listGrants(organizationId: string): Promise<Grant[]>;
  /** Most recent first. */
  listAudit(filter?: AuditFilter): Promise<AuditEvent[]>;
}

/** Per-call resolution options. Providers without a decision cache ignore them. */
export interface ResolveOptions {
  /**
   * The client is on a check-and-act path (`guard`, `requireWithin`, `requireEnabled`): return the current
   * value, never a cached one. A caching provider bypasses and refreshes its cache.
   */
  fresh?: boolean;
  /**
   * The caller supplied the evaluation time (`now`) rather than letting the client use its clock: a
   * time-travel query. A caching provider neither serves nor stores the result. When omitted,
   * RemoteProvider treats a supplied `now` as explicit; `false` identifies SDK-generated time.
   */
  explicitTime?: boolean;
}

export interface Provider {
  readonly metadata: ProviderMetadata;
  readonly capabilities: Capabilities;
  readonly mutations?: Mutations;
  readonly inspection?: Inspection;
  initialize?(): Promise<void>;
  shutdown?(): Promise<void>;
  resolve(privilege: PrivilegeDefinition, ctx: ResolvedContext, options?: ResolveOptions): Promise<ResolutionDetails>;
  suggestPlan?(privilege: PrivilegeDefinition, need: Need, ctx: ResolvedContext): Promise<string | undefined>;
}

/** Base for facts-based providers: implement a FactSource, get spec resolution for free. */
export abstract class FactsProvider implements Provider {
  abstract readonly metadata: ProviderMetadata;
  abstract readonly capabilities: Capabilities;
  protected abstract facts(): FactSource;

  resolve(privilege: PrivilegeDefinition, ctx: ResolvedContext): Promise<ResolutionDetails> {
    return resolveFromFacts(this.facts(), privilege, ctx);
  }

  suggestPlan(privilege: PrivilegeDefinition, need: Need, ctx: ResolvedContext): Promise<string | undefined> {
    return suggestPlanFromFacts(this.facts(), privilege, need, ctx);
  }
}

// ---------------------------------------------------------------- shared validation for mutations

export function newId(prefix: string): string {
  return `${prefix}_${globalThis.crypto.randomUUID().replaceAll("-", "").slice(0, 16)}`;
}

export function checkMeta(meta: MutationMeta): void {
  if (typeof meta.actor !== "string" || meta.actor.trim() === "") throw new InvalidArgument("mutation requires a non-empty actor");
  if (typeof meta.reason !== "string" || meta.reason.trim() === "") throw new InvalidArgument("mutation requires a non-empty reason");
}

export function assertValidValue(privilege: PrivilegeDefinition, value: unknown): void {
  const problem = validateValue(privilege, value);
  if (problem) throw new InvalidValue(problem);
}

export function assertValidScope(scope: Scope, allowResource: boolean): void {
  if (!scope.organizationId) throw new InvalidArgument("scope.organizationId is required");
  if (scope.subjectId === "") throw new InvalidArgument("scope.subjectId must be non-empty when present");
  if (scope.resourceId !== undefined && (!allowResource || scope.resourceId === ""))
    throw new InvalidArgument(allowResource ? "bad resourceId" : "grants cannot be scoped to a resource");
}

export function assertValidInterval(startsAt?: Date, expiresAt?: Date): void {
  if (startsAt && expiresAt && !(startsAt.getTime() < expiresAt.getTime())) throw new InvalidArgument("startsAt must be before expiresAt");
}

export function assertReason(reason: string, what: string): void {
  if (typeof reason !== "string" || reason.trim() === "") throw new InvalidArgument(`${what} requires a non-empty reason`);
}

const sameScope = (a: Scope, b: Scope) => a.organizationId === b.organizationId && a.subjectId === b.subjectId && a.resourceId === b.resourceId;

/** Requirement 1.5.7. */
export function assertNoOverrideConflict(input: OverrideInput, existing: Override[]): void {
  for (const o of existing) {
    if (sameScope(o.scope, input.scope) && o.privilege === input.privilege && intervalsOverlap(o.startsAt, o.expiresAt, input.startsAt, input.expiresAt))
      throw new Conflict(`override ${o.id} already covers ${input.privilege} for this scope and interval`);
  }
}

/** Requirement 1.6.2. */
export function assertValidGrant(privilege: PrivilegeDefinition, input: GrantInput): void {
  if (privilege.valueType !== "integer") throw new InvalidValue(`grants only apply to integer privileges, ${privilege.key} is ${privilege.valueType}`);
  if (!isInt(input.amount) || input.amount <= 0) throw new InvalidValue("grant amount must be a positive integer");
}
