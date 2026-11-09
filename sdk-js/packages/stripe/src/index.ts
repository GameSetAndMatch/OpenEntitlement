/**
 * Stripe Entitlements adapter for OpenEntitlement.
 *
 * Stripe models entitlements as *boolean* features (`lookup_key`) attached to products; a customer's
 * active entitlements derive from their subscriptions. This adapter maps them onto OpenEntitlement:
 *
 * - `lookup_key === "<privilege>"`               → boolean privilege is `true`
 * - `lookup_key === "<privilege>:<value>"`       → integer (`50`, `unlimited`), boolean or enum value
 * - `mapping: { "pro-bundle": { "seat_max": 50 } }` → explicit mapping for lookup keys you can't rename
 *
 * Several active entitlements for one privilege resolve to the most generous value. Stripe cannot say
 * "false": a boolean missing from a customer who *has* active entitlements resolves to `false` with reason
 * PLAN. Missing integer/enum privileges, and customers with no active entitlements, resolve to the default.
 * Overrides, grants, plan catalog and mutations are declared unsupported; layer them in your own store.
 *
 * No dependency on the Stripe SDK: fetch + node:crypto.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { NO_CAPABILITIES, Reason, UNLIMITED, isUnlimited, validateValue, type Capabilities, type PrivilegeDefinition, type Provider, type ResolutionDetails, type ResolvedContext } from "@openentitlement/core";

export const SUMMARY_EVENT = "entitlements.active_entitlement_summary.updated";

export type Transport = (url: string, headers: Record<string, string>) => Promise<{ status: number; body: string }>;

const fetchTransport: Transport = async (url, headers) => {
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(10_000) });
  return { status: res.status, body: await res.text() };
};

export class StripeError extends Error {
  readonly status: number;
  constructor(status: number, body: string) {
    super(`Stripe API returned ${status}: ${body.slice(0, 200)}`);
    this.status = status;
  }
}

/** "seat_max:50" → ["seat_max", "50"]; "sso_enabled" → ["sso_enabled", undefined]. */
export function parseLookupKey(lookupKey: string): [string, string | undefined] {
  const i = lookupKey.indexOf(":");
  return i < 0 ? [lookupKey, undefined] : [lookupKey.slice(0, i), lookupKey.slice(i + 1)];
}

function coerce(p: PrivilegeDefinition, raw: string | undefined): unknown {
  if (p.valueType === "boolean") {
    if (raw === undefined || raw === "true") return true;
    if (raw === "false") return false;
  } else if (p.valueType === "integer" && raw !== undefined) {
    if (raw === "unlimited" && p.unlimitedAllowed) return UNLIMITED;
    if (/^\d+$/.test(raw)) return Number(raw);
  } else if (p.valueType === "enum" && raw !== undefined && p.options.includes(raw)) return raw;
  throw new Error(`cannot map ${JSON.stringify(raw)} onto ${p.valueType} privilege ${p.key}`);
}

function moreGenerous(p: PrivilegeDefinition, a: unknown, b: unknown): unknown {
  if (p.valueType === "boolean") return a === true || b === true;
  if (p.valueType === "integer") return isUnlimited(a) || isUnlimited(b) ? UNLIMITED : Math.max(a as number, b as number);
  return p.options.indexOf(a as string) >= p.options.indexOf(b as string) ? a : b;
}

export interface StripeOptions {
  apiKey: string;
  /** Maps an organizationId to a Stripe customer id (cus_...), or undefined. */
  customerFor: (organizationId: string) => string | undefined | Promise<string | undefined>;
  /** Explicit lookup_key -> {privilege: value}; wins over the naming convention. */
  mapping?: Record<string, Record<string, unknown>>;
  /** Seconds to cache a customer's active entitlements (default 60). Webhooks refresh it immediately. */
  cacheTtl?: number;
  transport?: Transport;
  apiBase?: string;
  now?: () => number;
  logger?: Pick<Console, "warn">;
}

export class StripeEntitlementsProvider implements Provider {
  readonly metadata = { name: "stripe-entitlements" };
  readonly capabilities: Capabilities = NO_CAPABILITIES;
  readonly #o: Required<Omit<StripeOptions, "mapping">> & { mapping: Record<string, Record<string, unknown>> };
  readonly #cache = new Map<string, { expires: number; keys: string[] }>();

  constructor(options: StripeOptions) {
    if (!options.apiKey) throw new Error("apiKey is required");
    this.#o = {
      mapping: options.mapping ?? {},
      cacheTtl: options.cacheTtl ?? 60,
      transport: options.transport ?? fetchTransport,
      apiBase: (options.apiBase ?? "https://api.stripe.com").replace(/\/$/, ""),
      now: options.now ?? (() => Date.now() / 1000),
      logger: options.logger ?? console,
      apiKey: options.apiKey,
      customerFor: options.customerFor,
    };
  }

  async #get(path: string, params: Record<string, string>): Promise<any> {
    const url = `${this.#o.apiBase}${path}?${new URLSearchParams(params)}`;
    const { status, body } = await this.#o.transport(url, { Authorization: `Bearer ${this.#o.apiKey}` });
    if (status !== 200) throw new StripeError(status, body);
    return JSON.parse(body);
  }

  /** All active entitlement lookup keys for a customer (paginated, cached). */
  async activeLookupKeys(customerId: string): Promise<string[]> {
    const hit = this.#cache.get(customerId);
    if (hit && hit.expires > this.#o.now()) return hit.keys;
    const keys = new Set<string>();
    let params: Record<string, string> = { customer: customerId, limit: "100" };
    for (;;) {
      const page = await this.#get("/v1/entitlements/active_entitlements", params);
      const data: Array<{ id: string; lookup_key?: string }> = page.data ?? [];
      for (const e of data) if (e.lookup_key) keys.add(e.lookup_key);
      if (!page.has_more || data.length === 0) break;
      params = { ...params, starting_after: data[data.length - 1]!.id };
    }
    const result = [...keys].sort();
    this.#cache.set(customerId, { expires: this.#o.now() + this.#o.cacheTtl, keys: result });
    return result;
  }

  /** Feed verified webhook events here to keep the cache fresh (see `verifyWebhook`). */
  handleEvent(event: any): void {
    if (event?.type !== SUMMARY_EVENT) return;
    const obj = event.data?.object ?? {};
    if (!obj.customer) return;
    const ents = obj.entitlements ?? {};
    if (ents.has_more) this.#cache.delete(obj.customer); // the summary holds at most 10; refetch on next resolve
    else {
      const keys = [...new Set<string>((ents.data ?? []).map((e: any) => e.lookup_key).filter(Boolean))].sort();
      this.#cache.set(obj.customer, { expires: this.#o.now() + this.#o.cacheTtl, keys });
    }
  }

  valuesFromLookupKeys(keys: string[], p: PrivilegeDefinition): unknown[] {
    const found: unknown[] = [];
    for (const lk of keys) {
      const mapped = this.#o.mapping[lk];
      if (mapped) {
        if (p.key in mapped) {
          if (validateValue(p, mapped[p.key]) === undefined) found.push(mapped[p.key]);
          else this.#o.logger.warn(`openentitlement-stripe: mapping ${lk} -> ${p.key} is invalid; ignored`);
        }
        continue;
      }
      const [key, raw] = parseLookupKey(lk);
      if (key !== p.key) continue;
      try {
        found.push(coerce(p, raw));
      } catch (e) {
        this.#o.logger.warn(`openentitlement-stripe: lookup_key ${lk} ignored: ${(e as Error).message}`);
      }
    }
    return found;
  }

  async resolve(p: PrivilegeDefinition, ctx: ResolvedContext): Promise<ResolutionDetails> {
    const base = { privilege: p.key, grants: [], staleOverrides: [] };
    const customer = await this.#o.customerFor(ctx.organizationId);
    if (!customer) return { ...base, value: p.default, reason: Reason.DEFAULT };
    const keys = await this.activeLookupKeys(customer);
    const values = this.valuesFromLookupKeys(keys, p);
    if (values.length === 0) {
      if (keys.length > 0 && p.valueType === "boolean") return { ...base, value: false, reason: Reason.PLAN, planValue: false };
      return { ...base, value: p.default, reason: Reason.DEFAULT };
    }
    const value = values.reduce((a, b) => moreGenerous(p, a, b));
    return { ...base, value, reason: Reason.PLAN, planValue: value };
  }
}

/**
 * Verify a `Stripe-Signature` header (v1 scheme) and return the parsed event.
 * Throws when the signature is missing, wrong, or outside `tolerance` seconds.
 */
export function verifyWebhook(payload: string | Buffer, signatureHeader: string, secret: string, opts: { tolerance?: number; now?: number } = {}): any {
  const parts = new Map<string, string[]>();
  for (const item of signatureHeader.split(",")) {
    const [k, ...rest] = item.trim().split("=");
    if (k) parts.set(k, [...(parts.get(k) ?? []), rest.join("=")]);
  }
  const t = Number(parts.get("t")?.[0]);
  if (!Number.isInteger(t)) throw new Error("missing timestamp in Stripe-Signature");
  const body = typeof payload === "string" ? Buffer.from(payload) : payload;
  const expected = createHmac("sha256", secret).update(`${t}.`).update(body).digest();
  const ok = (parts.get("v1") ?? []).some((sig) => {
    const b = Buffer.from(sig, "hex");
    return b.length === expected.length && timingSafeEqual(b, expected);
  });
  if (!ok) throw new Error("no valid v1 signature");
  const tolerance = opts.tolerance ?? 300;
  const now = opts.now ?? Date.now() / 1000;
  if (tolerance && Math.abs(now - t) > tolerance) throw new Error("signature timestamp outside tolerance");
  const event = JSON.parse(body.toString("utf8"));
  if (event === null || typeof event !== "object" || Array.isArray(event)) throw new Error("payload is not a JSON object");
  return event;
}
