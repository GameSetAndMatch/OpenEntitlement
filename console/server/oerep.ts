/** OEREP v1 data plane, separate from the administrative /api surface. */
import type { IncomingMessage, ServerResponse } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { contextProblem, detailsToJSON, validateValue, type EvaluationContext } from "@openentitlement/core";
import type { Runtime } from "./config.ts";

class ProtocolError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}
export function createOerep(rt: Runtime, token?: string) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<boolean> => {
    const path = new URL(req.url ?? "/", "http://localhost").pathname;
    if (!path.startsWith("/oerep/")) return false;
    const send = (status: number, data: unknown) => {
      res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
      res.end(JSON.stringify(data));
    };
    try {
      if (token) {
        const expected = Buffer.from(`Bearer ${token}`), actual = Buffer.from(req.headers.authorization ?? "");
        if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new ProtocolError(401, "unauthorized");
      }
      const match = /^\/oerep\/v1\/(resolve|suggest)(?:\/([^/]+))?$/.exec(path);
      if (!match || (match[1] === "suggest" && !match[2])) throw new ProtocolError(404, "unknown OEREP endpoint");
      if (req.method !== "POST") throw new ProtocolError(405, "POST required");
      if (!/^application\/json(?:;|$)/i.test(req.headers["content-type"] ?? "")) throw new ProtocolError(415, "application/json required");
      const chunks: Buffer[] = []; let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 1_000_000) throw new ProtocolError(413, "body over 1 MB");
        chunks.push(chunk);
      }
      let body: any;
      try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
      catch { throw new ProtocolError(400, "invalid JSON"); }
      if (!body || typeof body !== "object" || Array.isArray(body) || !body.context || typeof body.context !== "object" || Array.isArray(body.context))
        throw new ProtocolError(400, "context object required");
      const raw = body.context;
      const ctx: EvaluationContext = { organizationId: raw.organizationId, subjectId: raw.subjectId, resourceId: raw.resourceId };
      if (contextProblem(ctx)) throw new ProtocolError(400, contextProblem(ctx)!);
      if (raw.now !== undefined) {
        const m = typeof raw.now === "string" && /^(\d{4})-(\d{2})-(\d{2})T([01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.exec(raw.now);
        if (!m || !Number.isFinite(Date.parse(raw.now)) || Number(m[2]) < 1 || Number(m[2]) > 12 || Number(m[3]) < 1 || Number(m[3]) > new Date(Date.UTC(Number(m[1]), Number(m[2]), 0)).getUTCDate())
          throw new ProtocolError(400, "now must be an RFC 3339 timestamp");
      }
      ctx.now = raw.now === undefined ? rt.client.clock() : new Date(raw.now);
      let key: string | undefined;
      try { key = match[2] === undefined ? undefined : decodeURIComponent(match[2]); }
      catch { throw new ProtocolError(400, "invalid privilege encoding"); }
      if (match[1] === "suggest") {
        const p = rt.catalog.privilege(key!);
        if (!p) throw new ProtocolError(404, "unknown privilege");
        if (validateValue(p, body.need) || (p.valueType === "boolean" && body.need !== true)) throw new ProtocolError(400, "invalid need");
        // requiredPlan first resolves, suppressing upsells when evaluation fails.
        const details = await rt.client.getDetails(key!, ctx);
        const requiredPlan = details.reason === "ERROR" ? undefined : await rt.client.provider.suggestPlan?.(p, body.need, ctx as import("@openentitlement/core").ResolvedContext);
        send(200, { requiredPlan: requiredPlan ?? null });
      } else if (key !== undefined) {
        if (!rt.catalog.privilege(key)) throw new ProtocolError(404, "unknown privilege");
        send(200, detailsToJSON(await rt.client.getDetails(key, ctx)));
      } else {
        const privileges = await Promise.all(rt.catalog.privileges.map(async (p) => detailsToJSON(await rt.client.getDetails(p.key, ctx))));
        send(200, { privileges });
      }
    } catch (error) {
      const status = error instanceof ProtocolError ? error.status : 500;
      send(status, { error: status === 500 ? "INTERNAL" : `HTTP_${status}`, message: status === 500 ? "internal error" : (error as Error).message });
    }
    return true;
  };
}
