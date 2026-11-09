import {environmentOverride,type EnvironmentOverrides} from "../environment.ts";
/** Workspace data is independent of deployment identity and OEREP transport. */
export type Value = boolean | number | string | { unlimited: true };
export type Role = "Owner" | "Manager" | "User";
export type Action = "catalog:write" | "tiers:write" | "organizations:write" | "contracts:write" | "members:manage" | "api_keys:manage";
export interface Group { id: string; name: string; description: string; parentId?: string }
export interface Feature { id: string; name: string; description: string; groupId?: string; hidden?:boolean; frozen?:boolean }
export interface Privilege { key: string; name: string; description: string; groupId?: string; featureId?: string; type: "boolean" | "integer" | "string"; minimum?: number; maximum?: number; enum?: string[]; unlimited?: boolean; default?: Value; envVariable?:string; hidden?:boolean; frozen?:boolean }
export interface Tier { id: string; name: string; rank: number; gracePeriodDays: number }
export interface Variant { id: string; name: string; tierId: string; kind: "standard" | "trial" | "grace"; values: Record<string, Value> }
export interface Organization { id: string; name: string; variantId: string; terms: Record<string, Value>; status: "active" | "past_due" | "ended"; graceEndsAt?: string }
export interface WorkspaceData { groups: Group[]; features: Feature[]; privileges: Privilege[]; tiers: Tier[]; variants: Variant[]; organizations: Organization[]; statusPolicy: { past_due: StatusPolicy; ended: StatusPolicy } }
export type StatusPolicy = { action: "readOnly" } | { action: "fallback"; variantId: string };
export const emptyData = (): WorkspaceData => ({ groups: [], features: [], privileges: [], tiers: [], variants: [], organizations: [], statusPolicy: { past_due: { action: "readOnly" }, ended: { action: "readOnly" } } });
export const actions: Action[] = ["catalog:write", "tiers:write", "organizations:write", "contracts:write", "members:manage", "api_keys:manage"];
export class WorkspaceError extends Error {
  status: number;
  constructor(message: string, status = 400) { super(message); this.status = status; }
}
export function object(input: unknown): Record<string, any> {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new WorkspaceError("An object is required");
  return input as Record<string, any>;
}
export function only(b: Record<string, unknown>, fields: string[]) {
  for(const key of Object.keys(b))if(!fields.includes(key))throw new WorkspaceError(`Unknown field: ${key}`);
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
  const b = object(input); only(b,["id","name","description","parentId"]); const id = identifier(b.id);
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
export function feature(data: WorkspaceData,input: unknown): Feature {
  const b=object(input);only(b,["id","name","description","groupId","hidden","frozen"]);const result: Feature={id:identifier(b.id),name:text(b.name,"Feature name"),description:description(b.description)};
  if(b.frozen!==undefined){if(typeof b.frozen!=="boolean")throw new WorkspaceError("Frozen must be a boolean");result.frozen=b.frozen;}
  if(b.hidden!==undefined){if(typeof b.hidden!=="boolean")throw new WorkspaceError("Hidden must be a boolean");result.hidden=b.hidden;}
  if((result.hidden||result.frozen)&&data.privileges.some(p=>p.featureId===result.id&&!Object.hasOwn(p,"default")))throw new WorkspaceError("Hidden or frozen privileges need a Catalog default");
  if(b.groupId){result.groupId=text(b.groupId,"Group");if(!data.groups.some(g=>g.id===result.groupId))throw new WorkspaceError("Group does not exist");}
  return result;
}
export function privilege(data: WorkspaceData, input: unknown): Privilege {
  const b = object(input); only(b,["key","name","description","groupId","featureId","type","minimum","maximum","enum","unlimited","default","envVariable","hidden","frozen"]); const key = identifier(b.key);
  if (!["boolean", "integer", "string"].includes(b.type)) throw new WorkspaceError("Choose boolean, integer or string");
  const result: Privilege = { key, name: text(b.name, "Feature name"), description: description(b.description), type: b.type, ...(Object.hasOwn(b,"default") ? { default: b.default } : {}) };
  if(b.frozen!==undefined){if(typeof b.frozen!=="boolean")throw new WorkspaceError("Frozen must be a boolean");result.frozen=b.frozen;}
  if(b.hidden!==undefined){if(typeof b.hidden!=="boolean")throw new WorkspaceError("Hidden must be a boolean");result.hidden=b.hidden;}
  if(b.envVariable!==undefined){if(b.type!=="boolean")throw new WorkspaceError("Environment bindings support boolean privileges only");if(!Object.hasOwn(b,"default"))throw new WorkspaceError("Environment-linked values need a Catalog default");if(typeof b.envVariable!=="string"||! /^[A-Z][A-Z0-9_]*$/.test(b.envVariable))throw new WorkspaceError("envVariable must be an uppercase environment variable name");result.envVariable=b.envVariable;}
  if (b.groupId) { result.groupId = text(b.groupId, "Group"); if (!data.groups.some(g => g.id === result.groupId)) throw new WorkspaceError("Group does not exist"); }
  if (!b.featureId) throw new WorkspaceError("Choose a feature for this privilege");
  if (b.featureId) { result.featureId=text(b.featureId,"Feature");if(!data.features.some(f=>f.id===result.featureId))throw new WorkspaceError("Feature does not exist"); }
  for (const field of ["minimum", "maximum"] as const) if (b[field] !== undefined) {
    if (b.type !== "integer" || !Number.isSafeInteger(b[field]) || b[field] < 0) throw new WorkspaceError(`${field} must be a non-negative integer on an integer privilege`);
    result[field] = b[field];
  }
  if ((result.minimum ?? 0) > (result.maximum ?? Number.MAX_SAFE_INTEGER)) throw new WorkspaceError("Minimum cannot exceed maximum");
  if (b.unlimited !== undefined) { if (b.type !== "integer" || typeof b.unlimited !== "boolean") throw new WorkspaceError("Unlimited is only available for integer privileges"); result.unlimited = b.unlimited; }
  if (b.enum !== undefined) { if (b.type !== "string" || !Array.isArray(b.enum) || !b.enum.length || b.enum.length > 100 || b.enum.some((v: unknown) => typeof v !== "string" || !v || v.length > 200) || new Set(b.enum).size !== b.enum.length) throw new WorkspaceError("Enum must contain unique non-empty strings"); result.enum = b.enum; }
  if((result.hidden||result.frozen||data.features.find(f=>f.id===result.featureId)?.hidden||data.features.find(f=>f.id===result.featureId)?.frozen)&&!Object.hasOwn(result,"default"))throw new WorkspaceError("Hidden or frozen privileges need a Catalog default");
  if (Object.hasOwn(result,"default")) { const error = valueError(result,result.default);if(error)throw new WorkspaceError(error,422); }
  else if(data.variants.some(v=>!Object.hasOwn(v.values,key)))throw new WorkspaceError(`Set ${key} in every existing variant before requiring tier values`,409);
  // Updating a definition may not invalidate existing negotiated or variant values.
  for (const row of [...data.variants.map(v => v.values), ...data.organizations.map(o => o.terms)]) if (Object.hasOwn(row, key)) { const e = valueError(result, row[key]); if (e) throw new WorkspaceError(`Existing value would become invalid: ${e}`, 409); }
  return result;
}
export function tier(input: unknown): Tier {
  const b = object(input); only(b,["id","name","rank","gracePeriodDays"]);
  if (!Number.isSafeInteger(b.rank) || b.rank < 0 || !Number.isSafeInteger(b.gracePeriodDays ?? 0) || (b.gracePeriodDays ?? 0) < 0 || (b.gracePeriodDays ?? 0) > 365) throw new WorkspaceError("Rank and grace days must be non-negative integers (grace at most 365 days)");
  return { id: identifier(b.id), name: text(b.name, "Tier name"), rank: b.rank, gracePeriodDays: b.gracePeriodDays ?? 0 };
}
export function variant(data: WorkspaceData, input: unknown): Variant {
  const b = object(input); only(b,["id","name","tierId","kind","values"]);
  if (!data.tiers.some(t => t.id === b.tierId) || !["standard","trial","grace"].includes(b.kind)) throw new WorkspaceError("Select a tier and variant purpose");
  const id = identifier(b.id);
  const existing=data.variants.find(v=>v.id===id);
  if(existing&&(existing.tierId!==b.tierId||existing.kind!==b.kind))throw new WorkspaceError("A variant’s tier and purpose cannot change. Create a new variant instead.",409);
  if (data.variants.some(v => v.id !== id && v.tierId === b.tierId && v.kind === b.kind)) throw new WorkspaceError("This tier already has a variant with that purpose", 409);
  const explicit=values(data,b.values??{});
  for(const p of data.privileges)if(!Object.hasOwn(p,"default")&&!Object.hasOwn(explicit,p.key))throw new WorkspaceError(`${p.key}: a value is required in this variant`,422);
  return { id, name: text(b.name, "Variant name"), tierId: b.tierId, kind: b.kind, values: explicit };
}
export function organization(data: WorkspaceData, input: unknown, now = new Date()): Organization {
  const b = object(input); only(b,["id","name","variantId","terms","status","graceEndsAt"]); const id = identifier(b.id);
  const assigned = data.variants.find(v => v.id === b.variantId);
  if (!assigned || assigned.kind === "grace") throw new WorkspaceError("Assign an existing standard or trial tier variant");
  if (!["active", "past_due", "ended"].includes(b.status ?? "active")) throw new WorkspaceError("Invalid contract status");
  const previous = data.organizations.find(o => o.id === id);
  const result: Organization = { id, name: text(b.name, "Organization name"), variantId: assigned.id, terms: values(data, b.terms ?? {}), status: b.status ?? "active" };
  if (result.status === "past_due") {
    if(data.tiers.find(t=>t.id===assigned.tierId)!.gracePeriodDays>0&&!data.variants.some(v=>v.tierId===assigned.tierId&&v.kind==="grace"))throw new WorkspaceError("Create a grace-period variant for this tier before using past-due grace");
    result.graceEndsAt = previous?.status === "past_due" && data.variants.find(v=>v.id===previous.variantId)?.tierId===assigned.tierId ? previous.graceEndsAt : new Date(now.getTime() + data.tiers.find(t => t.id === assigned.tierId)!.gracePeriodDays * 86400000).toISOString();
  }
  return result;
}
export function resolve(data: WorkspaceData, orgId: string, key: string, now = new Date(), environment:EnvironmentOverrides = {}) {
  const org = data.organizations.find(o => o.id === orgId), def = data.privileges.find(p => p.key === key);
  if (!org || !def) throw new WorkspaceError("Organization or privilege not found", 404);
  let assigned = data.variants.find(v => v.id === org.variantId)!;
  let readOnly = false, fallback = false, grace = false, missingGrace = false;
  if(org.status === "past_due" && org.graceEndsAt && now < new Date(org.graceEndsAt)) {
    const graceVariant=data.variants.find(v=>v.tierId===assigned.tierId&&v.kind==="grace");
    if(graceVariant){assigned=graceVariant;grace=true;}else missingGrace=true;
  }
  const restricted = missingGrace || org.status === "ended" || (org.status === "past_due" && (!org.graceEndsAt || now >= new Date(org.graceEndsAt)));
  if (restricted) {
    const policy = data.statusPolicy[org.status as "ended" | "past_due"];
    if (policy.action === "readOnly") readOnly = true;
    else { assigned = data.variants.find(v => v.id === policy.variantId)!; fallback = true; }
  }
  const contract = !fallback && !grace && Object.hasOwn(org.terms, key), explicit = Object.hasOwn(assigned.values, key);
  const effective=contract?org.terms[key]:explicit?assigned.values[key]:def.default;
  const binding=Object.hasOwn(environment,key)?environment[key]:undefined;
  const defaultFrozen=Boolean(def.frozen||data.features.find(f=>f.id===def.featureId)?.frozen);
  const frozen=Boolean(binding||defaultFrozen);
  if(effective===undefined)throw new WorkspaceError(`${key}: variant has no value`,422);
  return { privilege: key, environment:binding, frozen, value:binding?(defaultFrozen?def.default:effective)===true&&binding.value:defaultFrozen?def.default:effective, reason:binding?"ENVIRONMENT":frozen?"FROZEN":grace?"GRACE":contract?"CONTRACT":explicit?"VARIANT":"DEFAULT", variantId:assigned.id, readOnly, status:org.status,fallback,grace };
}
export function catalogEnvironment(data:WorkspaceData,env:NodeJS.ProcessEnv):EnvironmentOverrides {
 const result:EnvironmentOverrides={};
 for(const def of data.privileges)if(def.envVariable){try{result[def.key]=environmentOverride(def.key,def.envVariable,def.type,value=>valueError(def,value),env);}catch(e){throw new WorkspaceError((e as Error).message,422);}}
 return result;
}
