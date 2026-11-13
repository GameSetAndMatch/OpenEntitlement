/** Generic OEREP 0.1 HTTP provider with an opt-in short-lived decision cache and no vendor dependencies. */
import { validateValue, type PrivilegeDefinition } from "./catalog.ts";
import { ErrorCode, Reason, type ResolvedContext, type ResolutionDetails } from "./details.ts";
import type { Provider, ResolveOptions } from "./provider.ts";
import type { Need } from "./resolver.ts";
import { decodeValue, isInt, isUnlimited } from "./values.ts";

export interface RemoteProviderOptions {
  baseUrl: string;
  product: string;
  token?: string;
  timeoutMs?: number;
  /**
   * Opt-in decision cache TTL in milliseconds; off when absent. Cached values can be up to this stale,
   * so administrative changes take up to the TTL to be visible.
   */
  cacheTtlMs?: number;
  /** Bound on cached entries, evicted least recently used first. Default 10,000. */
  cacheMaxEntries?: number;
  fetch?: typeof globalThis.fetch;
  /** Monotonic millisecond clock for cache expiry; defaults to `performance.now`. Intended for tests. */
  monotonicClock?: () => number;
}

type BulkContext = Omit<ResolvedContext, "now"> & { now?: Date };

const copyDetails = (d: ResolutionDetails): ResolutionDetails =>
  ({ ...d, grants: d.grants.map((g) => ({ ...g })), staleOverrides: [...d.staleOverrides] });

/** Validate untrusted wire details before they reach quota calculations. */
export function decodeRemoteDetails(raw: unknown, p: PrivilegeDefinition, ctx?: Pick<ResolvedContext, "subjectId">): ResolutionDetails {
  if (!raw || typeof raw !== "object") throw new Error("invalid OEREP details");
  const d = raw as ResolutionDetails;
  if (d.privilege !== p.key || !Object.values(Reason).includes(d.reason) ||
      !Array.isArray(d.grants) || !Array.isArray(d.staleOverrides) ||
      d.staleOverrides.some((v) => typeof v !== "string") ||
      d.grants.some((g) => !g || typeof g.id !== "string" || !isInt(g.amount) || g.amount <= 0 ||
        (g.subjectId !== undefined && (typeof g.subjectId !== "string" || !g.subjectId))))
    throw new Error("invalid OEREP details");
  for (const k of ["feature", "planId", "overrideId", "requiredPlan", "errorMessage"] as const)
    if (d[k] !== undefined && typeof d[k] !== "string") throw new Error(`invalid OEREP ${k}`);
  const value = decodeValue(d.value);
  if (validateValue(p, value)) throw new Error("OEREP value does not match local catalog");
  const total = d.grants.reduce((sum, g) => sum + g.amount, 0);
  if ((d.grants.length > 0 && p.valueType !== "integer") ||
      new Set(d.grants.map((g) => g.id)).size !== d.grants.length || !isInt(total) ||
      d.grants.some((g) => g.subjectId !== undefined && g.subjectId !== ctx?.subjectId) ||
      (!isUnlimited(value) && p.valueType === "integer" && !isInt((value as number) - total)))
    throw new Error("inconsistent OEREP grants");
  if ((d.errorCode !== undefined && !Object.values(ErrorCode).includes(d.errorCode)) ||
      (d.reason === Reason.ERROR && (!d.errorCode || d.requiredPlan !== undefined)))
    throw new Error("invalid OEREP error");
  const out = { ...d, value };
  if ("planValue" in d) {
    out.planValue = decodeValue(d.planValue);
    if (validateValue(p, out.planValue)) throw new Error("invalid OEREP planValue");
  }
  // A remote server cannot promise a lock over application usage.
  delete out.lockDomain;
  return out;
}

/** RFC 9457 transport failure. The HTTP status is authoritative. */
export class OerepProblem extends Error {
  readonly type: string;
  readonly detail: string;
  readonly title: string;
  readonly members: Record<string, unknown>;
  readonly status: number;
  constructor(status: number, raw: unknown) {
    const p = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
    const type = typeof p.type === "string" ? p.type : "about:blank";
    super(`OEREP ${status} ${type}`);
    this.status = status;
    this.type = type;
    this.title = typeof p.title === "string" ? p.title : "";
    this.detail = typeof p.detail === "string" ? p.detail : "";
    this.members = { ...p };
  }
}

export class RemoteProvider implements Provider {
  readonly metadata = { name: "oerep" };
  readonly capabilities = { overrides: true, grants: true, planCatalog: true, mutations: false, fixed: false };
  readonly #url: string;
  readonly #options: RemoteProviderOptions;
  readonly #ttl: number | undefined;
  readonly #maxEntries: number;
  readonly #clock: () => number;
  /** Insertion order is recency order: the first key is least recently used. */
  readonly #cache = new Map<string, { expiresAt: number; details: ResolutionDetails }>();
  constructor(options: RemoteProviderOptions) {
    if (typeof options.product !== "string" || options.product.trim() !== options.product || !/^[a-z][a-z0-9_]*$/.test(options.product)) throw new Error("product must be a Product key");
    const url = new URL(options.baseUrl);
    if (!["http:", "https:"].includes(url.protocol) || url.search || url.hash || url.username || url.password)
      throw new Error("baseUrl must be an HTTP(S) URL without credentials, query or fragment");
    if (!Number.isFinite(options.timeoutMs ?? 5000) || (options.timeoutMs ?? 5000) <= 0)
      throw new Error("timeoutMs must be positive");
    if (options.cacheTtlMs !== undefined && (typeof options.cacheTtlMs !== "number" || !Number.isFinite(options.cacheTtlMs) || options.cacheTtlMs <= 0))
      throw new Error("cacheTtlMs must be a positive finite number of milliseconds");
    const max = options.cacheMaxEntries ?? 10_000;
    if (!Number.isSafeInteger(max) || max <= 0) throw new Error("cacheMaxEntries must be a positive integer");
    this.#url = url.toString().replace(/\/$/, "");
    this.#options = Object.freeze({ ...options });
    this.#ttl = options.cacheTtlMs;
    this.#maxEntries = max;
    this.#clock = options.monotonicClock ?? (() => performance.now());
  }
  /** Drop every cached resolution. */
  clearCache(): void {
    this.#cache.clear();
  }
  async shutdown(): Promise<void> {
    this.clearCache();
  }
  /** The entry key, or undefined when this request must bypass the cache. */
  #key(privilege: string, ctx: BulkContext): string | undefined {
    if (this.#ttl === undefined) return undefined;
    return JSON.stringify([this.#options.product, privilege, ctx.organizationId, ctx.subjectId ?? null, ctx.resourceId ?? null]);
  }
  #get(key: string): ResolutionDetails | undefined {
    const entry = this.#cache.get(key);
    if (!entry) return undefined;
    this.#cache.delete(key);
    if (this.#clock() >= entry.expiresAt) return undefined;
    this.#cache.set(key, entry);
    return copyDetails(entry.details);
  }
  #put(items: [string, ResolutionDetails][]): void {
    const expiresAt = this.#clock() + this.#ttl!;
    for (const [key, details] of items) {
      if (details.reason === Reason.ERROR) continue;
      this.#cache.delete(key);
      this.#cache.set(key, { expiresAt, details: copyDetails(details) });
    }
    for (const key of this.#cache.keys()) {
      if (this.#cache.size <= this.#maxEntries) break;
      this.#cache.delete(key);
    }
  }
  async #post(path: string, body: unknown): Promise<any> {
    const response = await (this.#options.fetch ?? globalThis.fetch)(`${this.#url}/oerep/v1/products/${encodeURIComponent(this.#options.product)}/privileges/${path}`, {
      method: "POST", redirect: "error",
      headers: { "content-type": "application/json", ...(this.#options.token ? { authorization: `Bearer ${this.#options.token}` } : {}) },
      body: JSON.stringify(body), signal: AbortSignal.timeout(this.#options.timeoutMs ?? 5000),
    });
    if (!response.ok) {
      let problem: unknown;
      try { problem = await response.json(); } catch { /* An invalid error body still fails closed. */ }
      throw new OerepProblem(response.status, problem);
    }
    return response.json();
  }
  /** `{ fresh: true }` skips a cached entry and refreshes it with the server's current value. */
  async resolve(p: PrivilegeDefinition, ctx: ResolvedContext, options?: ResolveOptions): Promise<ResolutionDetails> {
    const key = (options?.explicitTime ?? (ctx.now !== undefined)) ? undefined : this.#key(p.key, ctx);
    const hit = key === undefined || options?.fresh ? undefined : this.#get(key);
    if (hit) return hit;
    if (key !== undefined) this.#cache.delete(key);
    const d = decodeRemoteDetails(await this.#post(`${encodeURIComponent(p.key)}/resolve`, { context: ctx }), p, ctx);
    if (key !== undefined) this.#put([[key, d]]);
    return d;
  }
  /**
   * Resolve every listed privilege with one bulk request (`POST /oerep/v1/products/{product}/privileges/resolve`); pass `catalog.privileges`.
   * Results for privileges the local catalog does not declare are ignored; any invalid entry fails the call.
   * With a cache, results fill the per-privilege entries later single resolutions read.
   */
  async resolveAll(privileges: Iterable<PrivilegeDefinition>, ctx: BulkContext): Promise<Map<string, ResolutionDetails>> {
    const wanted = new Map([...privileges].map((p) => [p.key, p] as const));
    if (ctx.now === undefined) {
      for (const p of wanted.values()) {
        const key = this.#key(p.key, ctx);
        if (key !== undefined) this.#cache.delete(key);
      }
    }
    const data = await this.#post("resolve", { context: ctx });
    if (!data || typeof data !== "object" || !Array.isArray(data.privileges)) throw new Error("invalid OEREP bulk response");
    const out = new Map<string, ResolutionDetails>();
    for (const raw of data.privileges as unknown[]) {
      const key = raw && typeof raw === "object" ? (raw as { privilege?: unknown }).privilege : undefined;
      if (typeof key !== "string") throw new Error("invalid OEREP details");
      const p = wanted.get(key);
      if (!p) continue;
      if (out.has(key)) throw new Error("duplicate OEREP bulk result");
      out.set(key, decodeRemoteDetails(raw, p, ctx));
    }
    if (out.size !== wanted.size) throw new Error("OEREP bulk response is missing privileges");
    if (this.#ttl !== undefined)
      // A bulk call with an explicit \`now\` is a time-travel query: never stored.
      if (ctx.now === undefined) this.#put([...out].flatMap(([k, d]) => { const key = this.#key(k, ctx); return key === undefined ? [] : [[key, d] as [string, ResolutionDetails]]; }));
    return out;
  }
  /** Upgrade suggestions are never cached. */
  async suggestPlan(p: PrivilegeDefinition, need: Need, ctx: ResolvedContext): Promise<string | undefined> {
    const d = await this.#post(`${encodeURIComponent(p.key)}/upgrade`, { context: ctx, need });
    if (!d || !(d.requiredPlan === null || (typeof d.requiredPlan === "string" && d.requiredPlan)))
      throw new Error("invalid OEREP suggestion");
    return d.requiredPlan ?? undefined;
  }
}
