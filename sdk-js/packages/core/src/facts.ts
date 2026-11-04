/** Facts: plans, assignments, overrides, grants (spec §1.3-1.6). */

export interface Plan {
  id: string;
  name: string;
  rank?: number;
  /** Defaults to true. */
  public?: boolean;
  variantOf?: string;
}

/** Requirement 1.3.2. */
export function planFamily(p: Plan): string {
  return p.variantOf ?? p.id;
}

export interface Assignment {
  organizationId: string;
  planId: string;
  channel?: string;
}

export interface Scope {
  organizationId: string;
  subjectId?: string;
  resourceId?: string;
}

export interface Override {
  id: string;
  scope: Scope;
  privilege: string;
  value: unknown;
  planFamily: string;
  reason: string;
  startsAt?: Date;
  expiresAt?: Date;
  createdBy?: string;
}

export interface Grant {
  id: string;
  scope: Omit<Scope, "resourceId">;
  privilege: string;
  amount: number;
  reason: string;
  startsAt?: Date;
  expiresAt?: Date;
  revokedAt?: Date;
  createdBy?: string;
}

/** Half-open interval test, open-ended when a bound is missing (spec §3.1). */
export function within(t: Date, startsAt?: Date, expiresAt?: Date): boolean {
  return (startsAt === undefined || startsAt.getTime() <= t.getTime()) && (expiresAt === undefined || t.getTime() < expiresAt.getTime());
}

/** Whether [aStart, aEnd) and [bStart, bEnd) intersect (Requirement 1.5.7). */
export function intervalsOverlap(aStart?: Date, aEnd?: Date, bStart?: Date, bEnd?: Date): boolean {
  const aBeforeBEnds = bEnd === undefined || aStart === undefined || aStart.getTime() < bEnd.getTime();
  const bBeforeAEnds = aEnd === undefined || bStart === undefined || bStart.getTime() < aEnd.getTime();
  return aBeforeBEnds && bBeforeAEnds;
}

/** What a facts-based provider must be able to read. Each is called at most once per resolution. */
export interface FactSource {
  assignment(organizationId: string): Promise<Assignment | undefined>;
  plan(planId: string): Promise<Plan | undefined>;
  plans(): Promise<Plan[]>;
  /** `found` distinguishes "no value" from a value of `false`/`0`. */
  planValue(planId: string, privilege: string): Promise<{ found: boolean; value?: unknown }>;
  overrides(organizationId: string, privilege: string): Promise<Override[]>;
  grants(organizationId: string, privilege: string): Promise<Grant[]>;
}

export function planToJSON(p: Plan): Record<string, unknown> {
  return { id: p.id, name: p.name, rank: p.rank ?? null, public: p.public ?? true, variantOf: p.variantOf ?? null };
}

export function assignmentToJSON(a: Assignment): Record<string, unknown> {
  return { organizationId: a.organizationId, planId: a.planId, channel: a.channel ?? null };
}

const iso = (d?: Date) => (d ? d.toISOString() : null);

export function overrideToJSON(o: Override): Record<string, unknown> {
  return {
    id: o.id,
    scope: { organizationId: o.scope.organizationId, subjectId: o.scope.subjectId ?? null, resourceId: o.scope.resourceId ?? null },
    privilege: o.privilege,
    value: o.value,
    planFamily: o.planFamily,
    reason: o.reason,
    startsAt: iso(o.startsAt),
    expiresAt: iso(o.expiresAt),
    createdBy: o.createdBy ?? "",
  };
}

export function grantToJSON(g: Grant): Record<string, unknown> {
  return {
    id: g.id,
    scope: { organizationId: g.scope.organizationId, subjectId: g.scope.subjectId ?? null },
    privilege: g.privilege,
    amount: g.amount,
    reason: g.reason,
    startsAt: iso(g.startsAt),
    expiresAt: iso(g.expiresAt),
    revokedAt: iso(g.revokedAt),
    createdBy: g.createdBy ?? "",
  };
}
