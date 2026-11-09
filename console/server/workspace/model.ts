/** Workspace data is independent of deployment identity and OEREP transport. */
export type Value = boolean | number | string | { unlimited: true };
export type Role = "Owner" | "Manager" | "User";
export type Action = "catalog:write" | "tiers:write" | "organizations:write" | "contracts:write" | "members:manage" | "api_keys:manage";
export interface Group { id: string; name: string; description: string; parentId?: string }
export interface Privilege { key: string; name: string; description: string; groupId?: string; type: "boolean" | "integer" | "string"; minimum?: number; maximum?: number; enum?: string[]; unlimited?: boolean; default: Value }
export interface Tier { id: string; name: string; rank: number; gracePeriodDays: number }
export interface Variant { id: string; name: string; tierId: string; trial: boolean; values: Record<string, Value> }
export interface Organization { id: string; name: string; variantId: string; terms: Record<string, Value>; status: "active" | "past_due" | "ended"; graceEndsAt?: string }
export interface WorkspaceData { groups: Group[]; privileges: Privilege[]; tiers: Tier[]; variants: Variant[]; organizations: Organization[]; statusPolicy: { past_due: StatusPolicy; ended: StatusPolicy } }
export type StatusPolicy = { action: "readOnly" } | { action: "fallback"; variantId: string };
export const emptyData = (): WorkspaceData => ({ groups: [], privileges: [], tiers: [], variants: [], organizations: [], statusPolicy: { past_due: { action: "readOnly" }, ended: { action: "readOnly" } } });
export const actions: Action[] = ["catalog:write", "tiers:write", "organizations:write", "contracts:write", "members:manage", "api_keys:manage"];
export class WorkspaceError extends Error {
  status: number;
  constructor(message: string, status = 400) { super(message); this.status = status; }
}
export function object(input: unknown): Record<string, any> {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new WorkspaceError("An object is required");
  return input as Record<string, any>;
}
export function text(input: unknown, label: string, max = 200): string {
  if (typeof input !== "string" || !input.trim() || input.length > max) throw new WorkspaceError(`${label} is required (maximum ${max} characters)`);
  return input.trim();
}
export function identifier(input: unknown): string {
  const id = text(input, "Identifier", 80);
  if (!/^[a-z][a-z0-9_]*$/.test(id)) throw new WorkspaceError("Use a flat identifier: lowercase letters, numbers and underscores; no dots");
  return id;
}
export function valueError(def: Privilege, value: unknown): string | undefined {
  const fail = (message: string) => `${def.key}: ${message}`;
  if (typeof value === "object" && value !== null && !Array.isArray(value) && Object.keys(value).length === 1 && (value as any).unlimited === true)
    return def.type === "integer" && def.unlimited ? undefined : fail("unlimited is not allowed");
  if (def.type === "boolean") return typeof value === "boolean" ? undefined : fail("must be a boolean");
  if (def.type === "string") return typeof value === "string" && (!def.enum || def.enum.includes(value)) ? undefined : fail(def.enum ? `must be one of ${def.enum.join(", ")}` : "must be a string");
  if (typeof value !== "number" || !Number.isSafeInteger(value)) return fail("must be a whole number");
  if (value < (def.minimum ?? 0)) return fail(`must be ${def.minimum ?? 0} or greater`);
  if (def.maximum !== undefined && value > def.maximum) return fail(`must be ${def.maximum} or less`);
  return undefined;
}
export function values(data: WorkspaceData, input: unknown): Record<string, Value> {
  const result = object(input);
  for (const [key, value] of Object.entries(result)) {
    const def = data.privileges.find(p => p.key === key);
    if (!def) throw new WorkspaceError(`Unknown privilege: ${key}`);
    const error = valueError(def, value); if (error) throw new WorkspaceError(error, 422);
  }
  return structuredClone(result);
}
const description = (input: unknown) => input === undefined || input === "" ? "" : text(input, "Description", 2000);
export function group(data: WorkspaceData, input: unknown): Group {
  const b = object(input); const id = identifier(b.id);
  const result: Group = { id, name: text(b.name, "Group name"), description: description(b.description) };
  if (b.parentId) {
    result.parentId = text(b.parentId, "Parent group");
    if (!data.groups.some(g => g.id === result.parentId)) throw new WorkspaceError("Parent group does not exist");
    let parent: string | undefined = result.parentId;
    const seen = new Set([id]);
    while (parent) { if (seen.has(parent)) throw new WorkspaceError("Groups cannot contain cycles"); seen.add(parent); parent = data.groups.find(g => g.id === parent)?.parentId; }
  }
  return result;
}
export function privilege(data: WorkspaceData, input: unknown): Privilege {
  const b = object(input); const key = identifier(b.key);
  if (!["boolean", "integer", "string"].includes(b.type)) throw new WorkspaceError("Choose boolean, integer or string");
  const result: Privilege = { key, name: text(b.name, "Feature name"), description: description(b.description), type: b.type, default: b.default };
  if (b.groupId) { result.groupId = text(b.groupId, "Group"); if (!data.groups.some(g => g.id === result.groupId)) throw new WorkspaceError("Group does not exist"); }
  for (const field of ["minimum", "maximum"] as const) if (b[field] !== undefined) {
    if (b.type !== "integer" || !Number.isSafeInteger(b[field]) || b[field] < 0) throw new WorkspaceError(`${field} must be a non-negative integer on an integer privilege`);
    result[field] = b[field];
  }
  if ((result.minimum ?? 0) > (result.maximum ?? Number.MAX_SAFE_INTEGER)) throw new WorkspaceError("Minimum cannot exceed maximum");
  if (b.unlimited !== undefined) { if (b.type !== "integer" || typeof b.unlimited !== "boolean") throw new WorkspaceError("Unlimited is only available for integer privileges"); result.unlimited = b.unlimited; }
  if (b.enum !== undefined) { if (b.type !== "string" || !Array.isArray(b.enum) || !b.enum.length || b.enum.length > 100 || b.enum.some((v: unknown) => typeof v !== "string" || !v || v.length > 200) || new Set(b.enum).size !== b.enum.length) throw new WorkspaceError("Enum must contain unique non-empty strings"); result.enum = b.enum; }
  const error = valueError(result, result.default); if (error) throw new WorkspaceError(error, 422);
  // Updating a definition may not invalidate existing negotiated or variant values.
  for (const row of [...data.variants.map(v => v.values), ...data.organizations.map(o => o.terms)]) if (Object.hasOwn(row, key)) { const e = valueError(result, row[key]); if (e) throw new WorkspaceError(`Existing value would become invalid: ${e}`, 409); }
  return result;
}
export function tier(input: unknown): Tier {
  const b = object(input);
  if (!Number.isSafeInteger(b.rank) || b.rank < 0 || !Number.isSafeInteger(b.gracePeriodDays ?? 0) || (b.gracePeriodDays ?? 0) < 0 || (b.gracePeriodDays ?? 0) > 365) throw new WorkspaceError("Rank and grace days must be non-negative integers (grace at most 365 days)");
  return { id: identifier(b.id), name: text(b.name, "Tier name"), rank: b.rank, gracePeriodDays: b.gracePeriodDays ?? 0 };
}
export function variant(data: WorkspaceData, input: unknown): Variant {
  const b = object(input);
  if (!data.tiers.some(t => t.id === b.tierId) || typeof b.trial !== "boolean") throw new WorkspaceError("Select a tier and an explicit trial state");
  const id = identifier(b.id);
  if (data.variants.some(v => v.id !== id && v.tierId === b.tierId && v.trial === b.trial)) throw new WorkspaceError("This tier already has a variant with that trial state", 409);
  return { id, name: text(b.name, "Variant name"), tierId: b.tierId, trial: b.trial, values: values(data, b.values ?? {}) };
}
export function organization(data: WorkspaceData, input: unknown, now = new Date()): Organization {
  const b = object(input); const id = identifier(b.id);
  const assigned = data.variants.find(v => v.id === b.variantId);
  if (!assigned) throw new WorkspaceError("Select an existing tier variant");
  if (!["active", "past_due", "ended"].includes(b.status ?? "active")) throw new WorkspaceError("Invalid contract status");
  const previous = data.organizations.find(o => o.id === id);
  const result: Organization = { id, name: text(b.name, "Organization name"), variantId: assigned.id, terms: values(data, b.terms ?? {}), status: b.status ?? "active" };
  if (result.status === "past_due") {
    result.graceEndsAt = previous?.status === "past_due" ? previous.graceEndsAt : new Date(now.getTime() + data.tiers.find(t => t.id === assigned.tierId)!.gracePeriodDays * 86400000).toISOString();
  }
  return result;
}
export function resolve(data: WorkspaceData, orgId: string, key: string, now = new Date()) {
  const org = data.organizations.find(o => o.id === orgId), def = data.privileges.find(p => p.key === key);
  if (!org || !def) throw new WorkspaceError("Organization or privilege not found", 404);
  let assigned = data.variants.find(v => v.id === org.variantId)!;
  let readOnly = false, fallback = false;
  const restricted = org.status === "ended" || (org.status === "past_due" && (!org.graceEndsAt || now >= new Date(org.graceEndsAt)));
  if (restricted) {
    const policy = data.statusPolicy[org.status as "ended" | "past_due"];
    if (policy.action === "readOnly") readOnly = true;
    else { assigned = data.variants.find(v => v.id === policy.variantId)!; fallback = true; }
  }
  const contract = !fallback && Object.hasOwn(org.terms, key), explicit = Object.hasOwn(assigned.values, key);
  return { privilege: key, value: contract ? org.terms[key] : explicit ? assigned.values[key] : def.default, reason: contract ? "CONTRACT" : explicit ? "VARIANT" : "DEFAULT", variantId: assigned.id, readOnly, status: org.status, fallback };
}
