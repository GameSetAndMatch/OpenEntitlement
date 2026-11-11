/**
 * The normative resolution algorithm (spec §3), as pure functions over a FactSource.
 * Facts-based providers reuse these so every provider derives identical results (Requirement 3.1.10).
 */

import { validateValue, type PrivilegeDefinition } from "./catalog.ts";
import { ErrorCode, errorDetails, normalizeUsage, Reason, type GrantApplied, type ResolutionDetails, type ResolvedContext, type Usage } from "./details.ts";
import { InvalidArgument } from "./errors.ts";
import { planFamily, within, type FactSource, type Override, type Scope } from "./facts.ts";
import { addLimit, isInt, isUnlimited, UNLIMITED, type Limit } from "./values.ts";

function scopeMatches(scope: Scope, ctx: ResolvedContext): boolean {
  if (scope.organizationId !== ctx.organizationId) return false;
  if (scope.subjectId !== undefined && scope.subjectId !== ctx.subjectId) return false;
  if (scope.resourceId !== undefined && scope.resourceId !== ctx.resourceId) return false;
  return true;
}

/** Requirement 3.1.6: subject+resource > resource > subject > organization. */
function specificity(o: Override): number {
  const s = o.scope.subjectId !== undefined;
  const r = o.scope.resourceId !== undefined;
  return s && r ? 3 : r ? 2 : s ? 1 : 0;
}

const byId = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Resolve one privilege for one context at ctx.now (spec §3.1). */
export async function resolveFromFacts(facts: FactSource, privilege: PrivilegeDefinition, ctx: ResolvedContext): Promise<ResolutionDetails> {
  const key = privilege.key;
  const now = ctx.now;
  const assignment = await facts.assignment(ctx.organizationId);
  const plan = assignment ? await facts.plan(assignment.planId) : undefined;
  if (assignment && !plan) return errorDetails(key, privilege.default, ErrorCode.GENERAL, `assigned plan "${assignment.planId}" not found`);
  const family = plan ? planFamily(plan) : undefined;

  // 3.1.3 / 3.1.4
  let base: unknown = privilege.default;
  let reason: Reason = Reason.DEFAULT;
  let planValue: { value: unknown } | undefined;
  if (plan) {
    const pv = await facts.planValue(plan.id, key);
    if (pv.found) {
      const problem = validateValue(privilege, pv.value);
      if (problem) return errorDetails(key, privilege.default, ErrorCode.GENERAL, `stored plan value: ${problem}`);
      base = pv.value;
      reason = Reason.PLAN;
      planValue = { value: pv.value };
    }
  }

  // 3.1.5 / 3.1.6 / 3.1.9
  const matching = (await facts.overrides(ctx.organizationId, key)).filter((o) => scopeMatches(o.scope, ctx) && within(now, o.startsAt, o.expiresAt));
  const isActive = (o: Override) => family !== undefined && o.planFamily === family;
  const active = matching.filter(isActive).sort((a, b) => specificity(b) - specificity(a) || byId(a.id, b.id));
  const stale = matching.filter((o) => !isActive(o)).map((o) => o.id).sort(byId);
  let overrideId: string | undefined;
  const chosen = active[0];
  if (chosen) {
    const problem = validateValue(privilege, chosen.value);
    if (problem) return errorDetails(key, privilege.default, ErrorCode.GENERAL, `stored override: ${problem}`);
    base = chosen.value;
    reason = Reason.OVERRIDE;
    overrideId = chosen.id;
  }

  // 3.1.7
  let value = base;
  let applied: GrantApplied[] = [];
  if (privilege.valueType === "integer") {
    const grants = (await facts.grants(ctx.organizationId, key))
      .filter(
        (g) =>
          (g.revokedAt === undefined || g.revokedAt.getTime() > now.getTime()) &&
          within(now, g.startsAt, g.expiresAt) &&
          (g.scope.subjectId === undefined || g.scope.subjectId === ctx.subjectId),
      )
      .sort(
        (a, b) =>
          Number(a.scope.subjectId === undefined) - Number(b.scope.subjectId === undefined) || // subject allowance first
          Number(a.expiresAt === undefined) - Number(b.expiresAt === undefined) ||
          (a.expiresAt?.getTime() ?? 0) - (b.expiresAt?.getTime() ?? 0) ||
          byId(a.id, b.id),
      );
    applied = grants.map((g) => (g.scope.subjectId !== undefined ? { id: g.id, amount: g.amount, subjectId: g.scope.subjectId } : { id: g.id, amount: g.amount }));
    if (applied.length > 0) {
      value = addLimit(base as Limit, applied.reduce((s, g) => s + g.amount, 0));
      if (!isUnlimited(base)) reason = Reason.GRANT;
    }
  }

  const d: ResolutionDetails = { privilege: key, value, reason, grants: applied, staleOverrides: stale };
  if (plan) d.planId = plan.id;
  if (planValue) d.planValue = planValue.value;
  if (overrideId !== undefined) d.overrideId = overrideId;
  return d;
}

// ---------------------------------------------------------------------------- limit checks (§3.3)

export interface CheckResult {
  passed: boolean;
  limit: Limit;
  available: number | typeof UNLIMITED | undefined;
  neededPlanValue: number;
}

/** Apply Requirements 3.3.1 and 3.3.3 to resolved details. */
export function checkWithin(details: ResolutionDetails, current: Usage, requested: number): CheckResult {
  if (!isInt(requested)) throw new InvalidArgument(`requested must be an integer, got ${String(requested)}`);
  const usage = normalizeUsage(current);
  const value = details.value as Limit;
  const subjectGrants = details.grants.filter((g) => g.subjectId !== undefined).reduce((s, g) => s + g.amount, 0);
  // Personal grants never allow more than the resolved value. With a non-negative base they cannot
  // exceed it anyway; with a negative base (allowed since integer values may be negative) they could.
  const subjectAllowance = isUnlimited(details.value) ? subjectGrants : Math.min(subjectGrants, Math.max(0, details.value as number));
  const orgGrants = details.grants.filter((g) => g.subjectId === undefined).reduce((s, g) => s + g.amount, 0);
  const remainingSubject = Math.max(0, subjectAllowance - usage.subject);
  const neededPlanValue = Math.max(1, usage.pool + requested - remainingSubject - orgGrants);
  if (requested <= 0) return { passed: true, limit: value, available: undefined, neededPlanValue };
  if (isUnlimited(value)) return { passed: true, limit: value, available: UNLIMITED, neededPlanValue };
  const available = remainingSubject + Math.max(0, value - subjectAllowance - usage.pool);
  return { passed: requested <= available, limit: value, available, neededPlanValue };
}

// ---------------------------------------------------------------------------- required plan (§3.4)

/** true (boolean), the needed plan value (integer), or a target option (enum). */
export type Need = boolean | number | string;

/** Requirement 3.4.3. */
export function satisfies(p: PrivilegeDefinition, value: unknown, need: Need): boolean {
  if (p.valueType === "boolean") return value === true;
  if (p.valueType === "integer") return isUnlimited(value) || (isInt(value) && value >= (need as number));
  const v = p.options.indexOf(value as string);
  const n = p.options.indexOf(need as string);
  return v >= 0 && n >= 0 && v >= n;
}

/** Requirement 3.4.2: lowest-ranked public base plan above the current one that satisfies the need. */
export async function suggestPlanFromFacts(facts: FactSource, privilege: PrivilegeDefinition, need: Need, ctx: ResolvedContext): Promise<string | undefined> {
  const assignment = await facts.assignment(ctx.organizationId);
  const current = assignment ? await facts.plan(assignment.planId) : undefined;
  const candidates = (await facts.plans())
    .filter(
      (p) =>
        (p.public ?? true) &&
        p.variantOf === undefined &&
        p.rank !== undefined &&
        (!current || planFamily(p) !== planFamily(current)) &&
        (!current || current.rank === undefined || p.rank > current.rank),
    )
    .sort((a, b) => a.rank! - b.rank! || byId(a.id, b.id));
  for (const p of candidates) {
    const pv = await facts.planValue(p.id, privilege.key);
    if (pv.found && satisfies(privilege, pv.value, need)) return p.id;
  }
  return undefined;
}
