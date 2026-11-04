/**
 * Console HTTP API. Provider-agnostic: writes go through `client.admin` (spec §6.3), evaluation through
 * `getDetails` / `isEnabledDetails` (spec §4), listing through the optional Inspection capability (spec §6.6).
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import {
  decodeValue,
  detailsToJSON,
  EntitlementDenied,
  gateKey,
  OpenEntitlementError,
  planFamily,
  SPEC_VERSION,
  toHttpProblem,
  within,
  type EvaluationContext,
  type Override,
  type Grant,
} from "@openentitlement/core";
import type { ConsoleConfig, Runtime } from "./config.ts";

class HttpError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const STATUS_BY_CODE: Record<string, number> = {
  INVALID_ARGUMENT: 400,
  TYPE_MISMATCH: 400,
  INVALID_VALUE: 422,
  NOT_FOUND: 404,
  CONFLICT: 409,
  NOT_SUPPORTED: 501,
};

function send(res: ServerResponse, status: number, body: unknown, type = "application/json"): void {
  const text = JSON.stringify(body);
  res.writeHead(status, { "content-type": type, "cache-control": "no-store" });
  res.end(text);
}

async function readJson(req: IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > 1_000_000) throw new HttpError(413, "PAYLOAD_TOO_LARGE", "body over 1 MB");
    chunks.push(c as Buffer);
  }
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "INVALID_JSON", "request body is not valid JSON");
  }
}

const date = (v: unknown): Date | undefined => {
  if (v === undefined || v === null || v === "") return undefined;
  const d = new Date(String(v));
  if (Number.isNaN(d.getTime())) throw new HttpError(400, "INVALID_ARGUMENT", `invalid date ${JSON.stringify(v)}`);
  return d;
};

const str = (v: unknown): string | undefined => (typeof v === "string" && v !== "" ? v : undefined);

function bearer(req: IncomingMessage): string | undefined {
  const h = req.headers.authorization;
  return h?.startsWith("Bearer ") ? h.slice(7) : undefined;
}

type Handler = (ctx: { req: IncomingMessage; params: Record<string, string>; body: any; actor: string; query: URLSearchParams }) => Promise<unknown>;

export function createApi(cfg: ConsoleConfig, rt: Runtime) {
  const { client, catalog } = rt;
  const provider = client.provider;
  const routes: Array<{ method: string; pattern: RegExp; keys: string[]; handler: Handler }> = [];
  const route = (method: string, path: string, handler: Handler) => {
    const keys: string[] = [];
    const pattern = new RegExp("^" + path.replace(/:(\w+)/g, (_m, k: string) => (keys.push(k), "([^/]+)")) + "$");
    routes.push({ method, pattern, keys, handler });
  };

  const requireInspection = () => {
    if (!provider.inspection) throw new HttpError(501, "NOT_SUPPORTED", `provider "${provider.metadata.name}" does not support inspection (listing); use Evaluate`);
    return provider.inspection;
  };
  const meta = (actor: string, body: any) => ({ actor, reason: String(body?.reason ?? "") });

  const catalogJSON = () =>
    catalog.features.map((f) => ({
      code: f.code,
      name: f.name,
      description: f.description ?? "",
      gate: gateKey(f),
      privileges: f.privileges.map((p) => ({ key: p.key, valueType: p.valueType, default: p.default, unlimitedAllowed: p.unlimitedAllowed, options: p.options })),
    }));

  async function evaluateAll(ctx: EvaluationContext) {
    const privileges = await Promise.all(catalog.privileges.map(async (p) => detailsToJSON(await client.getDetails(p.key, ctx))));
    const features = await Promise.all(catalog.features.map(async (f) => detailsToJSON(await client.isEnabledDetails(f.code, ctx))));
    return { privileges, features };
  }

  function contextFrom(body: any): EvaluationContext {
    const ctx: EvaluationContext = { organizationId: String(body?.organizationId ?? "") };
    if (str(body?.subjectId)) ctx.subjectId = body.subjectId;
    if (str(body?.resourceId)) ctx.resourceId = body.resourceId;
    const at = date(body?.at ?? body?.now);
    if (at) ctx.now = at;
    return ctx;
  }

  // ------------------------------------------------------------------ meta

  route("GET", "/api/meta", async () => ({
    specVersion: SPEC_VERSION,
    provider: provider.metadata,
    capabilities: { ...provider.capabilities, inspection: Boolean(provider.inspection) },
    lockDomain: client.lock.domain,
    catalog: catalogJSON(),
  }));

  // ------------------------------------------------------------------ plans

  route("GET", "/api/plans", async () => requireInspection().listPlans());

  route("PUT", "/api/plans/:id", async ({ params, body, actor }) => {
    const plan: any = { id: params.id, name: String(body.name ?? "") };
    if (body.rank !== undefined && body.rank !== null && body.rank !== "") plan.rank = Number(body.rank);
    if (body.public === false) plan.public = false;
    if (str(body.variantOf)) plan.variantOf = body.variantOf;
    return client.admin.upsertPlan(plan, meta(actor, body));
  });

  route("PUT", "/api/plans/:id/values", async ({ params, body, actor }) => {
    // batch: {values: {privilege: value}, reason}; applied one by one, each audited
    const out = [];
    for (const [k, v] of Object.entries(body.values ?? {})) out.push(await client.admin.setPlanValue(params.id!, k, decodeValue(v), meta(actor, body)));
    return out;
  });

  // ------------------------------------------------------------------ organizations

  route("GET", "/api/organizations", async () => {
    const insp = requireInspection();
    const assignments = await insp.listAssignments();
    return Promise.all(
      assignments.map(async (a) => ({
        ...a,
        overrides: (await insp.listOverrides(a.organizationId)).length,
        grants: (await insp.listGrants(a.organizationId)).filter((g) => !g.revokedAt).length,
      })),
    );
  });

  route("GET", "/api/organizations/:org", async ({ params, query }) => {
    const org = params.org!;
    const now = date(query.get("at")) ?? client.clock();
    const evaluation = await evaluateAll({ organizationId: org, now });
    if (!provider.inspection) return { organizationId: org, assignment: null, overrides: [], grants: [], ...evaluation };
    const insp = provider.inspection;
    const [assignments, plans, overrides, grants] = await Promise.all([insp.listAssignments(), insp.listPlans(), insp.listOverrides(org), insp.listGrants(org)]);
    const assignment = assignments.find((a) => a.organizationId === org) ?? null;
    const plan = assignment ? plans.find((p) => p.id === assignment.planId) : undefined;
    const family = plan ? planFamily(plan) : undefined;
    const overrideStatus = (o: Override) =>
      o.startsAt && o.startsAt > now ? "scheduled" : !within(now, o.startsAt, o.expiresAt) ? "expired" : o.planFamily !== family ? "stale" : "active";
    const grantStatus = (g: Grant) =>
      g.revokedAt && g.revokedAt <= now ? "revoked" : g.startsAt && g.startsAt > now ? "scheduled" : !within(now, g.startsAt, g.expiresAt) ? "expired" : "active";
    return {
      organizationId: org,
      assignment,
      overrides: overrides.map((o) => ({ ...o, status: overrideStatus(o) })),
      grants: grants.map((g) => ({ ...g, status: grantStatus(g) })),
      ...evaluation,
    };
  });

  route("PUT", "/api/organizations/:org/plan", async ({ params, body, actor }) =>
    client.admin.assignPlan(params.org!, str(body.planId) ?? null, { ...meta(actor, body), ...(str(body.channel) ? { channel: body.channel } : {}) }),
  );

  route("POST", "/api/organizations/:org/overrides", async ({ params, body, actor }) => {
    const input: any = { organizationId: params.org!, privilege: String(body.privilege ?? ""), value: decodeValue(body.value) };
    if (str(body.subjectId)) input.subjectId = body.subjectId;
    if (str(body.resourceId)) input.resourceId = body.resourceId;
    if (str(body.planFamily)) input.planFamily = body.planFamily;
    const s = date(body.startsAt), e = date(body.expiresAt);
    if (s) input.startsAt = s;
    if (e) input.expiresAt = e;
    return client.admin.createOverride(input, meta(actor, body));
  });

  route("DELETE", "/api/overrides/:id", async ({ params, body, actor }) => client.admin.deleteOverride(params.id!, meta(actor, body)));

  route("POST", "/api/organizations/:org/grants", async ({ params, body, actor }) => {
    const input: any = { organizationId: params.org!, privilege: String(body.privilege ?? ""), amount: Number(body.amount) };
    if (str(body.subjectId)) input.subjectId = body.subjectId;
    const s = date(body.startsAt), e = date(body.expiresAt);
    if (s) input.startsAt = s;
    if (e) input.expiresAt = e;
    return client.admin.createGrant(input, meta(actor, body));
  });

  route("POST", "/api/grants/:id/revoke", async ({ params, body, actor }) => client.admin.revokeGrant(params.id!, meta(actor, body)));

  // ------------------------------------------------------------------ evaluation (works on every provider)

  route("POST", "/api/evaluate", async ({ body }) => evaluateAll(contextFrom(body)));

  route("POST", "/api/require", async ({ body }) => {
    try {
      const d = await client.requireWithin(String(body.privilege), body.current ?? 0, Number(body.requested ?? 1), contextFrom(body));
      return { allowed: true, details: detailsToJSON(d) };
    } catch (e) {
      if (e instanceof EntitlementDenied) return { allowed: false, problem: toHttpProblem(e).body };
      throw e;
    }
  });

  // ------------------------------------------------------------------ audit

  route("GET", "/api/audit", async ({ query }) => {
    const f: any = { limit: Math.min(Number(query.get("limit") ?? 200), 1000) };
    if (query.get("entity")) f.entity = query.get("entity");
    if (query.get("entityId")) f.entityId = query.get("entityId");
    return requireInspection().listAudit(f);
  });

  /** Returns true when handled. */
  return async function handle(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    const url = new URL(req.url ?? "/", "http://console.local");
    const isApi = url.pathname.startsWith("/api/");
    if (!isApi) return false;
    try {
      const token = cfg.adminToken;
      if (token && bearer(req) !== token) throw new HttpError(401, "UNAUTHORIZED", "missing or invalid bearer token");
      for (const r of routes) {
        if (r.method !== req.method) continue;
        const m = r.pattern.exec(url.pathname);
        if (!m) continue;
        const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1]!)]));
        const body = req.method === "GET" ? {} : await readJson(req);
        const actor = str(req.headers["x-oe-actor"]) ?? str(body?.actor) ?? "console";
        const result = await r.handler({ req, params, body, actor, query: url.searchParams });
        send(res, 200, result ?? null);
        return true;
      }
      throw new HttpError(404, "NOT_FOUND", `no route ${req.method} ${url.pathname}`);
    } catch (e) {
      if (e instanceof HttpError) send(res, e.status, { error: e.code, message: e.message });
      else if (e instanceof EntitlementDenied) send(res, 403, toHttpProblem(e).body);
      else if (e instanceof OpenEntitlementError) send(res, STATUS_BY_CODE[e.code] ?? 400, { error: e.code, message: e.message });
      else if (e && typeof e === "object" && "code" in e && typeof (e as any).code === "string" && /^[A-Z_]+$/.test((e as any).code))
        send(res, 403, { error: (e as any).code, message: String((e as any).message) }); // e.g. a vetoing mutation hook
      else {
        console.error(e);
        send(res, 500, { error: "INTERNAL", message: "internal error" });
      }
      return true;
    }
  };
}
