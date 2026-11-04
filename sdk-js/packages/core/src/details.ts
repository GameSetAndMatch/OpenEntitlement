/** Evaluation context, resolution details, reasons, usage (spec §2, §4.3-4.5). */

import { InvalidArgument } from "./errors.ts";
import { encodeValue, isInt } from "./values.ts";

export const Reason = {
  PLAN: "PLAN",
  OVERRIDE: "OVERRIDE",
  GRANT: "GRANT",
  FIXED: "FIXED",
  DEFAULT: "DEFAULT",
  ERROR: "ERROR",
} as const;
export type Reason = (typeof Reason)[keyof typeof Reason];

export const ErrorCode = {
  PROVIDER_NOT_READY: "PROVIDER_NOT_READY",
  PRIVILEGE_NOT_FOUND: "PRIVILEGE_NOT_FOUND",
  FEATURE_NOT_FOUND: "FEATURE_NOT_FOUND",
  TYPE_MISMATCH: "TYPE_MISMATCH",
  INVALID_CONTEXT: "INVALID_CONTEXT",
  GENERAL: "GENERAL",
} as const;
export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

/** Spec §2. `now` is filled from the client's clock when absent. */
export interface EvaluationContext {
  organizationId?: string;
  subjectId?: string;
  resourceId?: string;
  now?: Date;
}

/** A context as providers receive it: organization set and validated, `now` set. */
export interface ResolvedContext {
  organizationId: string;
  subjectId?: string;
  resourceId?: string;
  now: Date;
}

/** Invocation fields take precedence (Requirement 2.2.1). */
export function mergeContext(base: EvaluationContext, invocation?: EvaluationContext): EvaluationContext {
  if (!invocation) return { ...base };
  const out: EvaluationContext = { ...base };
  const org = invocation.organizationId || base.organizationId;
  if (org !== undefined) out.organizationId = org;
  if (invocation.subjectId !== undefined) out.subjectId = invocation.subjectId;
  if (invocation.resourceId !== undefined) out.resourceId = invocation.resourceId;
  if (invocation.now !== undefined) out.now = invocation.now;
  return out;
}

export function contextProblem(ctx: EvaluationContext): string | undefined {
  if (typeof ctx.organizationId !== "string" || ctx.organizationId === "") return "organizationId is required";
  for (const k of ["subjectId", "resourceId"] as const) {
    const v = ctx[k];
    if (v !== undefined && (typeof v !== "string" || v === "")) return `${k} must be a non-empty string when present`;
  }
  return undefined;
}

export interface GrantApplied {
  id: string;
  amount: number;
  subjectId?: string;
}

/** Spec §4.3: the counterpart of OpenFeature's FlagEvaluationDetails. Serialize with `JSON.stringify`. */
export interface ResolutionDetails<T = unknown> {
  privilege: string;
  value: T;
  reason: Reason;
  grants: GrantApplied[];
  staleOverrides: string[];
  feature?: string;
  planId?: string;
  /** Present (possibly `false`/`0`) when the plan sets a value; check with `"planValue" in details`. */
  planValue?: unknown;
  overrideId?: string;
  requiredPlan?: string;
  errorCode?: ErrorCode;
  errorMessage?: string;
  lockDomain?: string;
}

export function errorDetails<T>(privilege: string, value: T, errorCode: ErrorCode, errorMessage: string, feature?: string): ResolutionDetails<T> {
  const d: ResolutionDetails<T> = { privilege, value, reason: Reason.ERROR, grants: [], staleOverrides: [], errorCode, errorMessage };
  if (feature !== undefined) d.feature = feature;
  return d;
}

/** JSON form (Requirement 4.3.3); UNLIMITED serializes itself, this just drops undefined fields. */
export function detailsToJSON(d: ResolutionDetails): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(d)) if (v !== undefined) out[k] = k === "value" || k === "planValue" ? encodeValue(v) : v;
  return out;
}

/** Requirement 3.3.2: consumption drawn from the pool and from the subject allowance. */
export interface UsageBreakdown {
  pool: number;
  subject?: number;
}
export type Usage = number | UsageBreakdown;

export function normalizeUsage(current: unknown): { pool: number; subject: number } {
  let u: { pool: unknown; subject: unknown };
  if (typeof current === "number") u = { pool: current, subject: 0 };
  else if (current !== null && typeof current === "object") u = { pool: (current as UsageBreakdown).pool ?? 0, subject: (current as UsageBreakdown).subject ?? 0 };
  else throw new InvalidArgument(`current must be a number or a usage breakdown, got ${String(current)}`);
  if (!isInt(u.pool) || !isInt(u.subject) || u.pool < 0 || u.subject < 0)
    throw new InvalidArgument(`usage must be non-negative integers, got ${JSON.stringify(current)}`);
  return { pool: u.pool, subject: u.subject };
}

/** Pool draw implied by the draw order (Requirement 3.3.4). */
export function poolUsage(usageBySubject: Record<string, number>, allowanceBySubject: Record<string, number>, unattributed = 0): number {
  let total = unattributed;
  for (const [s, used] of Object.entries(usageBySubject)) total += Math.max(0, used - (allowanceBySubject[s] ?? 0));
  return total;
}
