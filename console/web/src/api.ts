/** Thin client for the console API. Values use the spec's JSON encoding: UNLIMITED is {"unlimited": true}. */

export type Json = any;
export type ValueType = "boolean" | "integer" | "enum";

export interface PrivilegeDef {
  environment?:import("../../server/environment.ts").EnvironmentOverride;
  frozen?:boolean;
  hidden?:boolean;
  envVariable?:string;
  key: string;
  valueType: ValueType;
  default: Json;
  unlimitedAllowed: boolean;
  options: string[];
}
export interface FeatureDef {
  hidden?:boolean;
  code: string;
  name: string;
  description: string;
  gate: string;
  privileges: PrivilegeDef[];
}
export interface Capabilities {
  overrides: boolean;
  grants: boolean;
  mutations: boolean;
  planCatalog: boolean;
  fixed: boolean;
  inspection: boolean;
}
export interface Meta {
  specVersion: string;
  provider: { name: string };
  capabilities: Capabilities;
  lockDomain: string;
  catalog: FeatureDef[];
}
export interface Plan {
  id: string;
  name: string;
  rank?: number;
  public?: boolean;
  variantOf?: string;
  values: Record<string, Json>;
}
export interface Details {
  frozen?:boolean;
  environment?:import("../../server/environment.ts").EnvironmentOverride;
  privilege: string;
  value: Json;
  reason: "PLAN" | "OVERRIDE" | "GRANT" | "FIXED" | "DEFAULT" | "ERROR";
  grants: Array<{ id: string; amount: number; subjectId?: string }>;
  staleOverrides: string[];
  feature?: string;
  planId?: string;
  planValue?: Json;
  overrideId?: string;
  requiredPlan?: string;
  errorCode?: string;
  errorMessage?: string;
}
export interface AuditEvent {
  actor: string;
  reason: string;
  entity: string;
  entityId: string;
  action: string;
  before: Json;
  after: Json;
  at: string;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export const actor = {
  get: () => localStorage.getItem("oe.actor") || "",
  set: (v: string) => localStorage.setItem("oe.actor", v),
};
export const token = {
  get: () => localStorage.getItem("oe.token") || "",
  set: (v: string) => localStorage.setItem("oe.token", v),
};

export async function api<T = Json>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (actor.get()) headers["x-oe-actor"] = actor.get();
  if (token.get()) headers.authorization = `Bearer ${token.get()}`;
  const res = await fetch(path, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, data?.error ?? "HTTP_" + res.status, data?.message ?? data?.title ?? res.statusText);
  return data as T;
}

export const isUnlimited = (v: Json) => v !== null && typeof v === "object" && v.unlimited === true;
export const UNLIMITED = { unlimited: true } as const;

export function formatValue(v: Json): string {
  if (v === undefined) return "—";
  if (v === null) return "∅";
  if (isUnlimited(v)) return "Unlimited";
  if (typeof v === "boolean") return v ? "On" : "Off";
  if (typeof v === "number") return v.toLocaleString();
  return String(v);
}

/** Binary document requests use the same admin credential, never a token in a URL. */
export async function documentRequest(path: string, method = "GET", body?: File, reason?: string): Promise<Response> {
  const headers: Record<string, string> = {};
  if (token.get()) headers.authorization = `Bearer ${token.get()}`;
  if (actor.get()) headers["x-oe-actor"] = actor.get();
  if (body) headers["content-type"] = "application/pdf";
  if (reason) headers["x-oe-reason"] = encodeURIComponent(reason);
  const res = await fetch(path, { method, headers, body });
  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new ApiError(res.status, error.error ?? "HTTP_ERROR", error.message ?? res.statusText);
  }
  return res;
}
