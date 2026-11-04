/** Generic OEREP v1 HTTP provider. No cached authorization decisions or vendor dependencies. */
import { validateValue, type PrivilegeDefinition } from "./catalog.ts";
import { ErrorCode, Reason, type ResolvedContext, type ResolutionDetails } from "./details.ts";
import type { Provider } from "./provider.ts";
import type { Need } from "./resolver.ts";
import { decodeValue, isInt } from "./values.ts";

export interface RemoteProviderOptions {
  baseUrl: string;
  token?: string;
  timeoutMs?: number;
  fetch?: typeof globalThis.fetch;
}

/** Validate untrusted wire details before they reach quota calculations. */
export function decodeRemoteDetails(raw: unknown, p: PrivilegeDefinition): ResolutionDetails {
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

export class RemoteProvider implements Provider {
  readonly metadata = { name: "oerep" };
  readonly capabilities = { overrides: true, grants: true, planCatalog: true, mutations: false, fixed: false };
  readonly #url: string;
  readonly #options: RemoteProviderOptions;
  constructor(options: RemoteProviderOptions) {
    const url = new URL(options.baseUrl);
    if (!["http:", "https:"].includes(url.protocol) || url.search || url.hash || url.username || url.password)
      throw new Error("baseUrl must be an HTTP(S) URL without credentials, query or fragment");
    if (!Number.isFinite(options.timeoutMs ?? 5000) || (options.timeoutMs ?? 5000) <= 0)
      throw new Error("timeoutMs must be positive");
    this.#url = url.toString().replace(/\/$/, "");
    this.#options = options;
  }
  async #post(path: string, body: unknown): Promise<any> {
    const response = await (this.#options.fetch ?? globalThis.fetch)(`${this.#url}/oerep/v1/${path}`, {
      method: "POST", redirect: "error",
      headers: { "content-type": "application/json", ...(this.#options.token ? { authorization: `Bearer ${this.#options.token}` } : {}) },
      body: JSON.stringify(body), signal: AbortSignal.timeout(this.#options.timeoutMs ?? 5000),
    });
    if (!response.ok) throw new Error(`OEREP HTTP ${response.status}`);
    return response.json();
  }
  async resolve(p: PrivilegeDefinition, ctx: ResolvedContext): Promise<ResolutionDetails> {
    return decodeRemoteDetails(await this.#post(`resolve/${encodeURIComponent(p.key)}`, { context: ctx }), p);
  }
  async suggestPlan(p: PrivilegeDefinition, need: Need, ctx: ResolvedContext): Promise<string | undefined> {
    const d = await this.#post(`suggest/${encodeURIComponent(p.key)}`, { context: ctx, need });
    if (!d || !(d.requiredPlan === null || (typeof d.requiredPlan === "string" && d.requiredPlan)))
      throw new Error("invalid OEREP suggestion");
    return d.requiredPlan ?? undefined;
  }
}
