/** Error types (spec §8.1) and the HTTP problem mapping (spec §8.2). */

import type { ResolutionDetails, Usage } from "./details.ts";
import { encodeValue, type Limit } from "./values.ts";

export class OpenEntitlementError extends Error {
  readonly code: string = "GENERAL";
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/** Base for denials; map every subclass to one HTTP 403 (Requirement 8.1.3). */
export class EntitlementDenied extends OpenEntitlementError {
  readonly feature: string;
  readonly privilege: string;
  readonly details: ResolutionDetails;
  readonly requiredPlan: string | undefined;
  constructor(message: string, init: { feature: string; privilege: string; details: ResolutionDetails; requiredPlan?: string | undefined }) {
    super(message);
    this.feature = init.feature;
    this.privilege = init.privilege;
    this.details = init.details;
    this.requiredPlan = init.requiredPlan;
  }
}

export class EntitlementLimitExceeded extends EntitlementDenied {
  override readonly code = "entitlement_limit_exceeded";
  readonly limit: Limit;
  readonly current: Usage;
  readonly requested: number;
  constructor(init: {
    feature: string;
    privilege: string;
    limit: Limit;
    current: Usage;
    requested: number;
    details: ResolutionDetails;
    requiredPlan?: string | undefined;
  }) {
    super(`${init.privilege}: requested ${init.requested} with current ${JSON.stringify(init.current)} exceeds limit ${String(init.limit)}`, init);
    this.limit = init.limit;
    this.current = init.current;
    this.requested = init.requested;
  }
}

export class FeatureNotEntitled extends EntitlementDenied {
  override readonly code = "feature_not_entitled";
  constructor(init: { feature: string; privilege: string; details: ResolutionDetails; requiredPlan?: string | undefined }) {
    super(`feature "${init.feature}" is not entitled`, init);
  }
}

export class TypeMismatch extends OpenEntitlementError {
  override readonly code = "TYPE_MISMATCH";
}
export class InvalidArgument extends OpenEntitlementError {
  override readonly code = "INVALID_ARGUMENT";
}
export class NotSupported extends OpenEntitlementError {
  override readonly code = "NOT_SUPPORTED";
}
export class NotFound extends OpenEntitlementError {
  override readonly code = "NOT_FOUND";
}
export class Conflict extends OpenEntitlementError {
  override readonly code = "CONFLICT";
}
export class InvalidValue extends OpenEntitlementError {
  override readonly code = "INVALID_VALUE";
}
/** Throw from a provider to signal PROVIDER_NOT_READY (Requirement 6.1.5). */
export class ProviderNotReady extends OpenEntitlementError {
  override readonly code = "PROVIDER_NOT_READY";
}

export const PROBLEM_TYPE = "urn:openentitlement:problem:entitlement-required";

export interface HttpProblem {
  type: string;
  title: string;
  status: 403;
  error: "entitlement_required";
  code: string;
  feature: string;
  privilege: string;
  limit?: unknown;
  current?: unknown;
  requested?: number;
  requiredPlan?: string;
}

/** Map a denial to an RFC 9457 problem body with status 403 (Requirement 8.2.1). */
export function toHttpProblem(error: EntitlementDenied): { status: 403; body: HttpProblem } {
  if (!(error instanceof EntitlementDenied)) throw new TypeError("toHttpProblem only maps EntitlementDenied errors");
  const body: HttpProblem = {
    type: PROBLEM_TYPE,
    title: "Entitlement required",
    status: 403,
    error: "entitlement_required",
    code: error.code,
    feature: error.feature,
    privilege: error.privilege,
  };
  if (error instanceof EntitlementLimitExceeded) {
    body.limit = encodeValue(error.limit);
    body.current = typeof error.current === "number" ? error.current : { pool: error.current.pool, subject: error.current.subject ?? 0 };
    body.requested = error.requested;
  }
  if (error.requiredPlan !== undefined) body.requiredPlan = error.requiredPlan;
  return { status: 403, body };
}
