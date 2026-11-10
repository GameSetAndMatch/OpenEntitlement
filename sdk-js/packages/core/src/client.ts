/** The evaluation client (spec §4), guard (spec §5) and admin interface (spec §6.3, §7.2). */

import { Catalog, gateKey, validateValue, type FeatureDefinition, type PrivilegeDefinition, type ValueType } from "./catalog.ts";
import {
  contextProblem,
  ErrorCode,
  errorDetails,
  mergeContext,
  normalizeUsage,
  Reason,
  type EvaluationContext,
  type ResolutionDetails,
  type ResolvedContext,
  type Usage,
} from "./details.ts";
import { EntitlementLimitExceeded, FeatureNotEntitled, InvalidArgument, NotFound, NotSupported, ProviderNotReady, TypeMismatch } from "./errors.ts";
import type { Plan, Scope } from "./facts.ts";
import type { Hook, HookContext, MutationContext, MutationHook } from "./hooks.ts";
import { InProcessLock, lockKey, type Lock } from "./lock.ts";
import { checkMeta, type AuditEvent, type GrantInput, type MutationMeta, type Mutations, type OverrideInput, type Provider } from "./provider.ts";
import { checkWithin, type Need } from "./resolver.ts";
import { isInt, isUnlimited, type Limit } from "./values.ts";

export const SPEC_VERSION = "0.1.0";

export interface ClientOptions {
  provider: Provider;
  catalog: Catalog | FeatureDefinition[];
  context?: EvaluationContext;
  hooks?: Hook[];
  mutationHooks?: MutationHook[];
  clock?: () => Date;
  lock?: Lock<any>;
  logger?: Pick<Console, "error">;
}

/** Passed to `error` hooks when resolution returns reason ERROR. */
export class EvaluationError extends Error {
  readonly details: ResolutionDetails;
  constructor(details: ResolutionDetails) {
    super(`${details.errorCode ?? "ERROR"}: ${details.errorMessage ?? ""}`);
    this.details = details;
  }
}

export interface GuardResult<R> {
  result: R;
  details: ResolutionDetails<Limit>;
}

/** Requirement 4.1.1. */
export function createClient(options: ClientOptions): EntitlementClient {
  return new EntitlementClient(options);
}

export class EntitlementClient {
  readonly provider: Provider;
  readonly catalog: Catalog;
  readonly context: EvaluationContext;
  readonly hooks: Hook[];
  readonly mutationHooks: MutationHook[];
  readonly clock: () => Date;
  readonly lock: Lock<any>;
  readonly admin: AdminClient;
  readonly #log: Pick<Console, "error">;
  #init: Promise<unknown> | undefined;
  #initError: unknown;

  constructor(o: ClientOptions) {
    this.provider = o.provider;
    this.catalog = o.catalog instanceof Catalog ? o.catalog : new Catalog(o.catalog);
    this.context = { ...(o.context ?? {}) };
    this.hooks = [...(o.hooks ?? [])];
    this.mutationHooks = [...(o.mutationHooks ?? [])];
    this.clock = o.clock ?? (() => new Date());
    this.lock = o.lock ?? new InProcessLock();
    this.#log = o.logger ?? console;
    this.admin = new AdminClient(this);
  }

  /** Requirement 4.1.2. */
  get providerMetadata() {
    return this.provider.metadata;
  }

  /** Requirement 6.1.6: initialize once, before the first resolve. */
  async #ensureInitialized(): Promise<unknown> {
    this.#init ??= (async () => {
      try {
        await this.provider.initialize?.();
      } catch (e) {
        this.#initError = e ?? new Error("initialize failed");
      }
    })();
    await this.#init;
    return this.#initError;
  }

  #merge(ctx?: EvaluationContext): EvaluationContext & { now: Date } {
    const m = mergeContext(this.context, ctx);
    return { ...m, now: m.now ?? this.clock() };
  }

  async #safe(what: string, fn: () => unknown): Promise<void> {
    try {
      await fn();
    } catch (e) {
      this.#log.error(`openentitlement: ${what} hook failed`, e);
    }
  }

  async #evaluate(key: string, ctx: EvaluationContext | undefined, opts: { expect?: ValueType; fallback: unknown; feature?: string; fresh?: boolean; explicitTime?: boolean }): Promise<ResolutionDetails> {
    // A caller-supplied `now` is a time-travel query: tell caching providers not to serve or store it.
    const explicitTime = opts.explicitTime ?? (mergeContext(this.context, ctx).now !== undefined);
    const merged = this.#merge(ctx);
    const priv = this.catalog.privilege(key);
    const hctx: HookContext = {
      privilege: key,
      valueType: priv?.valueType,
      ...(opts.feature !== undefined ? { feature: opts.feature } : {}),
      context: merged,
      providerMetadata: this.provider.metadata,
      hookData: new Map(),
    };
    const withFeature = (d: ResolutionDetails) => (opts.feature !== undefined ? { ...d, feature: opts.feature } : d);
    try {
      for (const h of this.hooks) await h.before?.(hctx);
    } catch (e) {
      // Requirement 7.1.5
      const d = withFeature(errorDetails(key, priv ? priv.default : opts.fallback, ErrorCode.GENERAL, `before hook: ${String(e)}`));
      for (const h of [...this.hooks].reverse()) await this.#safe("error", () => h.error?.(hctx, e));
      for (const h of [...this.hooks].reverse()) await this.#safe("finally", () => h.finally?.(hctx, d));
      return d;
    }
    const d = withFeature(await this.#resolve(key, priv, merged, { ...opts, explicitTime }));
    for (const h of [...this.hooks].reverse()) {
      if (d.reason === Reason.ERROR) await this.#safe("error", () => h.error?.(hctx, new EvaluationError(d)));
      else await this.#safe("after", () => h.after?.(hctx, d));
    }
    for (const h of [...this.hooks].reverse()) await this.#safe("finally", () => h.finally?.(hctx, d));
    return d;
  }

  async #resolve(
    key: string,
    priv: PrivilegeDefinition | undefined,
    ctx: EvaluationContext & { now: Date },
    opts: { expect?: ValueType; fallback: unknown; fresh?: boolean; explicitTime?: boolean },
  ): Promise<ResolutionDetails> {
    if (!priv) return errorDetails(key, opts.fallback, ErrorCode.PRIVILEGE_NOT_FOUND, `"${key}" is not in the catalog`);
    if (opts.expect && priv.valueType !== opts.expect)
      return errorDetails(key, opts.fallback, ErrorCode.TYPE_MISMATCH, `${key} is ${priv.valueType}, not ${opts.expect}`);
    const problem = contextProblem(ctx);
    if (problem) return errorDetails(key, priv.default, ErrorCode.INVALID_CONTEXT, problem);
    const initError = await this.#ensureInitialized();
    if (initError !== undefined) return errorDetails(key, priv.default, ErrorCode.PROVIDER_NOT_READY, `initialize failed: ${String(initError)}`);
    let d: ResolutionDetails;
    try {
      const options = { ...(opts.fresh ? { fresh: true } : {}), explicitTime: opts.explicitTime ?? true };
      d = await this.provider.resolve(priv, ctx as ResolvedContext, options);
    } catch (e) {
      if (e instanceof ProviderNotReady) return errorDetails(key, priv.default, ErrorCode.PROVIDER_NOT_READY, e.message);
      return errorDetails(key, priv.default, ErrorCode.GENERAL, `provider error: ${String(e)}`); // Requirement 6.1.5
    }
    if (!d || typeof d !== "object") return errorDetails(key, priv.default, ErrorCode.GENERAL, "provider returned no resolution details");
    if (d.reason === Reason.ERROR) return { ...d, value: priv.default, grants: [] };
    const invalid = validateValue(priv, d.value);
    if (invalid) return errorDetails(key, priv.default, ErrorCode.GENERAL, `provider returned an invalid value: ${invalid}`);
    return d;
  }

  async #suggest(priv: PrivilegeDefinition, need: Need, ctx?: EvaluationContext): Promise<string | undefined> {
    if (!this.provider.capabilities.planCatalog || !this.provider.suggestPlan) return undefined;
    const merged = this.#merge(ctx);
    if (contextProblem(merged)) return undefined;
    try {
      return await this.provider.suggestPlan(priv, need, merged as ResolvedContext);
    } catch (e) {
      this.#log.error("openentitlement: suggestPlan failed", e);
      return undefined;
    }
  }

  // ---------------------------------------------------------------- generic (Requirement 4.2.7)

  /** Resolve any privilege with no type expectation; never throws. */
  getDetails(privilege: string, ctx?: EvaluationContext): Promise<ResolutionDetails> {
    return this.#evaluate(privilege, ctx, { fallback: null });
  }

  // ---------------------------------------------------------------- features (4.2.1, 4.2.2)

  isEnabledDetails(feature: string, ctx?: EvaluationContext): Promise<ResolutionDetails<boolean>> {
    return this.#isEnabledDetails(feature, ctx, false);
  }

  async #isEnabledDetails(feature: string, ctx: EvaluationContext | undefined, fresh: boolean): Promise<ResolutionDetails<boolean>> {
    const f = this.catalog.feature(feature);
    if (!f) return errorDetails("", false, ErrorCode.FEATURE_NOT_FOUND, `feature "${feature}" is not in the catalog`, feature);
    const gate = this.catalog.privilege(gateKey(f))!;
    const d = await this.#evaluate(gate.key, ctx, { feature, fallback: gate.default, fresh });
    const v = d.value;
    const enabled = gate.valueType === "boolean" ? v === true : isUnlimited(v) || (isInt(v) && v > 0);
    const out: ResolutionDetails<boolean> = { ...d, value: enabled };
    if (!enabled && d.reason !== Reason.ERROR) {
      const required = await this.#suggest(gate, gate.valueType === "boolean" ? true : 1, ctx);
      if (required !== undefined) out.requiredPlan = required;
    }
    return out;
  }

  async isEnabled(feature: string, ctx?: EvaluationContext): Promise<boolean> {
    return (await this.isEnabledDetails(feature, ctx)).value;
  }

  /** A check-and-act gate: never served from a provider-side decision cache. */
  async requireEnabled(feature: string, ctx?: EvaluationContext): Promise<ResolutionDetails<boolean>> {
    const d = await this.#isEnabledDetails(feature, ctx, true);
    if (!d.value) {
      const f = this.catalog.feature(feature);
      throw new FeatureNotEntitled({ feature, privilege: f ? gateKey(f) : d.privilege, details: d, requiredPlan: d.requiredPlan });
    }
    return d;
  }

  // ---------------------------------------------------------------- limits (4.2.3, 4.2.4)

  getLimitDetails(privilege: string, ctx?: EvaluationContext): Promise<ResolutionDetails<Limit>> {
    return this.#evaluate(privilege, ctx, { expect: "integer", fallback: 0 }) as Promise<ResolutionDetails<Limit>>;
  }

  async getLimit(privilege: string, ctx?: EvaluationContext): Promise<Limit> {
    return (await this.getLimitDetails(privilege, ctx)).value;
  }

  /**
   * Check-only: NOT atomic with whatever you do next. Use `guard` for that (Requirement 5.1.1).
   * Like `guard`, never served from a provider-side decision cache.
   */
  async requireWithin(privilege: string, current: Usage, requested: number, ctx?: EvaluationContext): Promise<ResolutionDetails<Limit>> {
    if (!isInt(requested)) throw new InvalidArgument(`requested must be an integer, got ${String(requested)}`);
    normalizeUsage(current); // validates (Requirement 3.3.2)
    const priv = this.catalog.privilege(privilege);
    if (priv && priv.valueType !== "integer") throw new TypeMismatch(`requireWithin needs an integer privilege; ${privilege} is ${priv.valueType}`);
    const d = await this.#evaluate(privilege, ctx, { expect: "integer", fallback: 0, fresh: true }) as ResolutionDetails<Limit>;
    return this.#checkResolvedLimit(privilege, d, current, requested, ctx);
  }

  async #checkResolvedLimit(privilege: string, d: ResolutionDetails<Limit>, current: Usage, requested: number, ctx?: EvaluationContext): Promise<ResolutionDetails<Limit>> {
    const priv = this.catalog.privilege(privilege);
    if (priv && priv.valueType !== "integer") throw new TypeMismatch(`requireWithin needs an integer privilege; ${privilege} is ${priv.valueType}`);
    const result = checkWithin(d, current, requested);
    if (result.passed) return d;
    let requiredPlan: string | undefined;
    if (priv && d.reason !== Reason.ERROR) requiredPlan = await this.#suggest(priv, result.neededPlanValue, ctx);
    if (requiredPlan !== undefined) d = { ...d, requiredPlan };
    throw new EntitlementLimitExceeded({ feature: priv?.feature ?? "", privilege, limit: d.value, current, requested, details: d, requiredPlan });
  }

  // ---------------------------------------------------------------- enums (4.2.5)

  getEnumDetails(privilege: string, ctx?: EvaluationContext): Promise<ResolutionDetails<string>> {
    return this.#evaluate(privilege, ctx, { expect: "enum", fallback: "" }) as Promise<ResolutionDetails<string>>;
  }

  async getEnum(privilege: string, ctx?: EvaluationContext): Promise<string> {
    return (await this.getEnumDetails(privilege, ctx)).value;
  }

  // ---------------------------------------------------------------- required plan (4.2.6)

  /** `need`: true (boolean), {current, requested} (integer), or an option (enum). */
  async requiredPlan(privilege: string, need: true | { current: Usage; requested: number } | string, ctx?: EvaluationContext): Promise<string | undefined> {
    const priv = this.catalog.privilege(privilege);
    if (!priv) return undefined;
    let n: Need;
    if (priv.valueType === "integer") {
      if (typeof need !== "object") throw new InvalidArgument("integer need must be {current, requested}");
      const d = await this.getLimitDetails(privilege, ctx);
      if (d.reason === Reason.ERROR) return undefined;
      n = checkWithin(d, need.current, need.requested).neededPlanValue;
    } else n = need as Need;
    return this.#suggest(priv, n, ctx);
  }

  // ---------------------------------------------------------------- guard (§5)

  /** Serialized check-then-act (Requirement 5.2.1). */
  async guard<R, Tx = any>(
    privilege: string,
    requested: number,
    ctx: EvaluationContext | undefined,
    fns: { count: (tx: Tx) => Usage | Promise<Usage>; act: (tx: Tx) => R | Promise<R> },
  ): Promise<GuardResult<R>> {
    const explicitTime = mergeContext(this.context, ctx).now !== undefined;
    const merged = this.#merge(ctx);
    const problem = contextProblem(merged);
    if (problem) throw new InvalidArgument(problem);
    return this.lock.run(lockKey(merged.organizationId!, privilege), async (tx: Tx) => {
      // Check-and-act: always the provider's current limit, never a cached one.
      const resolved = await this.#evaluate(privilege, merged, { expect: "integer", fallback: 0, fresh: true, explicitTime }) as ResolutionDetails<Limit>;
      const current = await fns.count(tx);
      const details = await this.#checkResolvedLimit(privilege, resolved, current, requested, merged);
      const result = await fns.act(tx);
      return { result, details: { ...details, lockDomain: this.lock.domain } };
    });
  }
}

/** Mutations with hooks and audit (spec §6.3, §7.2). Access via `client.admin`. */
export class AdminClient {
  readonly #c: EntitlementClient;
  constructor(client: EntitlementClient) {
    this.#c = client;
  }

  #privilege(key: string): PrivilegeDefinition {
    const p = this.#c.catalog.privilege(key);
    if (!p) throw new NotFound(`privilege "${key}" is not in the catalog`);
    return p;
  }

  async #mutate(operation: string, args: Record<string, unknown>, meta: MutationMeta, fn: (m: Mutations, at: Date) => Promise<AuditEvent>): Promise<AuditEvent> {
    checkMeta(meta);
    const m = this.#c.provider.mutations;
    if (!m || !this.#c.provider.capabilities.mutations) throw new NotSupported(`provider "${this.#c.provider.metadata.name}" does not support mutations`);
    const mctx: MutationContext = { operation, arguments: args, actor: meta.actor, reason: meta.reason, providerMetadata: this.#c.provider.metadata };
    const hooks = this.#c.mutationHooks;
    const safe = async (fn: () => unknown) => {
      try {
        await fn();
      } catch (e) {
        console.error("openentitlement: mutation hook failed", e);
      }
    };
    let event: AuditEvent;
    try {
      for (const h of hooks) await h.before?.(mctx);
      event = await fn(m, this.#c.clock());
    } catch (e) {
      for (const h of [...hooks].reverse()) await safe(() => h.error?.(mctx, e));
      for (const h of [...hooks].reverse()) await safe(() => h.finally?.(mctx));
      throw e;
    }
    for (const h of [...hooks].reverse()) await safe(() => h.after?.(mctx, event)); // Requirement 7.2.4
    for (const h of [...hooks].reverse()) await safe(() => h.finally?.(mctx));
    return event;
  }

  upsertPlan(plan: Plan, meta: MutationMeta) {
    return this.#mutate("upsertPlan", { plan }, meta, (m, at) => m.upsertPlan(plan, meta, at));
  }

  setPlanValue(planId: string, privilege: string, value: unknown, meta: MutationMeta) {
    return this.#mutate("setPlanValue", { planId, privilege, value }, meta, (m, at) => m.setPlanValue(planId, this.#privilege(privilege), value, meta, at));
  }

  /** Pass `planId: null` to remove the assignment. */
  assignPlan(organizationId: string, planId: string | null, meta: MutationMeta & { channel?: string }) {
    const { channel, ...m2 } = meta;
    return this.#mutate("assignPlan", { organizationId, planId, channel }, m2, (m, at) => m.assignPlan(organizationId, planId, channel, m2, at));
  }

  createOverride(
    input: { organizationId: string; subjectId?: string; resourceId?: string; privilege: string; value: unknown; startsAt?: Date; expiresAt?: Date; planFamily?: string; id?: string },
    meta: MutationMeta,
  ) {
    const scope: Scope = { organizationId: input.organizationId };
    if (input.subjectId !== undefined) scope.subjectId = input.subjectId;
    if (input.resourceId !== undefined) scope.resourceId = input.resourceId;
    const data: OverrideInput = { scope, privilege: input.privilege, value: input.value, reason: meta.reason };
    for (const k of ["startsAt", "expiresAt", "planFamily", "id"] as const) if (input[k] !== undefined) (data as any)[k] = input[k];
    return this.#mutate("createOverride", { override: data }, meta, (m, at) => m.createOverride(data, this.#privilege(input.privilege), meta, at));
  }

  deleteOverride(overrideId: string, meta: MutationMeta) {
    return this.#mutate("deleteOverride", { overrideId }, meta, (m, at) => m.deleteOverride(overrideId, meta, at));
  }

  createGrant(
    input: { organizationId: string; subjectId?: string; privilege: string; amount: number; startsAt?: Date; expiresAt?: Date; id?: string },
    meta: MutationMeta,
  ) {
    const scope: GrantInput["scope"] = { organizationId: input.organizationId };
    if (input.subjectId !== undefined) scope.subjectId = input.subjectId;
    const data: GrantInput = { scope, privilege: input.privilege, amount: input.amount, reason: meta.reason };
    for (const k of ["startsAt", "expiresAt", "id"] as const) if (input[k] !== undefined) (data as any)[k] = input[k];
    return this.#mutate("createGrant", { grant: data }, meta, (m, at) => m.createGrant(data, this.#privilege(input.privilege), meta, at));
  }

  revokeGrant(grantId: string, meta: MutationMeta) {
    return this.#mutate("revokeGrant", { grantId }, meta, (m, at) => m.revokeGrant(grantId, meta, at));
  }
}
