import { createHash, randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Contract, ContractEvidence } from "../contracts.ts";
import type { ConsoleConfig, Runtime } from "./config.ts";
import { HttpError, readJson, send } from "./http.ts";
const MAX_PDF = 10 * 1024 * 1024;
const text = (value: unknown, name: string, required = true, max = 500): string => {
  if (value === undefined && !required) return "";
  if (typeof value !== "string" || value.length > max || (required && !value.trim())) throw new HttpError(400, "INVALID_ARGUMENT", `invalid ${name}`);
  return value.trim();
};
const uuid = (value: string) => {
  if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value)) throw new HttpError(400, "INVALID_ARGUMENT", "invalid contract or document id");
  return value;
};
function fields(body: any) {
  const title = text(body.title, "title");
  const status = body.status ?? "draft";
  if (!["draft", "active", "expired", "terminated"].includes(status)) throw new HttpError(400, "INVALID_ARGUMENT", "invalid contract status");
  const dates: { startsAt?: string; endsAt?: string } = {};
  for (const key of ["startsAt", "endsAt"] as const) {
    if (body[key]) {
      if (typeof body[key] !== "string" || !/^\d{4}-\d\d-\d\dT/.test(body[key]) || !Number.isFinite(Date.parse(body[key]))) throw new HttpError(400, "INVALID_ARGUMENT", `invalid ${key}`);
      dates[key] = new Date(body[key]).toISOString();
    }
  }
  if (dates.startsAt && dates.endsAt && dates.startsAt >= dates.endsAt) throw new HttpError(400, "INVALID_ARGUMENT", "contract end must follow its start");
  const refs = body.externalReferences ?? [];
  if (!Array.isArray(refs) || refs.length > 20) throw new HttpError(400, "INVALID_ARGUMENT", "invalid external references");
  return { title, status: status as Contract["status"], reference: text(body.reference, "reference", false), ...dates,
    externalReferences: refs.map(r => ({ system: text(r?.system, "source system", true, 80), reference: text(r?.reference, "source reference") })) };
}

export function createContractsApi(cfg: ConsoleConfig, rt: Runtime) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<boolean> => {
    const url = new URL(req.url ?? "/", "http://console.local");
    const match = /^\/api\/contracts(?:\/([^/]+))?(?:\/(documents|evidence)(?:\/([^/]+))?)?$/.exec(url.pathname);
    if (!match && !url.pathname.startsWith("/api/contracts")) return false;
    // Confidential documents are never available in anonymous demonstration mode.
    if (!cfg.adminToken) throw new HttpError(503, "CONTRACTS_DISABLED", "Configure OE_ADMIN_TOKEN to manage private contracts");
    if (!match) throw new HttpError(404, "NOT_FOUND", "unknown contracts endpoint");
    const id = match[1] ? uuid(match[1]) : undefined;
    const section = match[2], docId = match[3] ? uuid(match[3]) : undefined;
    const store = rt.contracts;
    const actor = text(req.headers["x-oe-actor"] ?? "console", "actor");
    const audit = (reason: unknown, action: string) => ({ actor, reason: text(reason, "reason", true, 2000), action, at: new Date().toISOString() });
    if (req.method === "GET" && !id) { send(res, 200, await store.list(text(url.searchParams.get("organizationId"), "organizationId"))); return true; }
    if (req.method === "GET" && id && !section) { send(res, 200, await store.get(id)); return true; }
    if (req.method === "GET" && id && section === "documents" && docId) {
      const doc = await store.document(id, docId);
      res.writeHead(200, { "content-type": "application/pdf", "content-disposition": `attachment; filename="contract.pdf"; filename*=UTF-8''${encodeURIComponent(doc.filename).replaceAll("'", "%27")}`,
        "cache-control": "no-store", "x-content-type-options": "nosniff", "content-security-policy": "sandbox; default-src 'none'", "content-length": doc.content.length });
      res.end(doc.content); return true;
    }
    if (req.method === "POST" && id && section === "documents" && !docId) {
      if (req.headers["content-type"]?.split(";")[0] !== "application/pdf") throw new HttpError(415, "INVALID_DOCUMENT", "upload must be application/pdf");
      const event = audit(req.headers["x-oe-reason"], "attach_pdf");
      const filename = text(url.searchParams.get("filename"), "filename", true, 160).replace(/[\x00-\x1f\x7f/\\]/g, "_");
      if (!filename.toLowerCase().endsWith(".pdf")) throw new HttpError(400, "INVALID_DOCUMENT", "filename must end in .pdf");
      if (Number(req.headers["content-length"]) > MAX_PDF) { req.resume(); throw new HttpError(413, "PAYLOAD_TOO_LARGE", "PDF exceeds 10 MiB"); }
      const chunks: Buffer[] = []; let size = 0;
      for await (const chunk of req.iterator({ destroyOnReturn: false })) {
        size += chunk.length;
        if (size > MAX_PDF) { req.resume(); throw new HttpError(413, "PAYLOAD_TOO_LARGE", "PDF exceeds 10 MiB"); }
        chunks.push(chunk);
      }
      const content = Buffer.concat(chunks);
      if (!content.subarray(0, 5).equals(Buffer.from("%PDF-")) || !content.subarray(-1024).includes(Buffer.from("%%EOF"))) throw new HttpError(422, "INVALID_DOCUMENT", "missing PDF header or end marker");
      const doc = { id: randomUUID(), filename, size, sha256: createHash("sha256").update(content).digest("hex"), uploadedAt: event.at };
      send(res, 200, await store.change(id, c => {
        if (c.documents.length >= 20) throw new HttpError(409, "DOCUMENT_LIMIT", "maximum 20 PDFs per contract");
        c.documents.push(doc); c.history.push(event);
      }, { id: doc.id, content })); return true;
    }
    if (req.method === "POST" || req.method === "PATCH") {
      const body = await readJson(req);
      if (!body || typeof body !== "object" || Array.isArray(body)) throw new HttpError(400, "INVALID_ARGUMENT", "object body required");
      if (!id && req.method === "POST") {
        const contract: Contract = { id: randomUUID(), organizationId: text(body.organizationId, "organizationId"), ...fields(body), documents: [], evidence: [], history: [audit(body.reason, "create_contract")] };
        send(res, 200, await store.create(contract)); return true;
      }
      if (id && !section && req.method === "PATCH") {
        const values = fields(body), event = audit(body.reason, "update_contract");
        send(res, 200, await store.change(id, c => {
          delete c.startsAt; delete c.endsAt;
          Object.assign(c, values); c.history.push(event);
        })); return true;
      }
      if (id && section === "evidence" && !docId && req.method === "POST") {
        const contract = await store.get(id);
        const kind = body.kind;
        if (kind !== "override" && kind !== "grant") throw new HttpError(400, "INVALID_ARGUMENT", "evidence must identify an override or grant");
        if (!rt.client.provider.inspection) throw new HttpError(501, "NOT_SUPPORTED", "provider cannot inspect entitlement sources");
        const entities = kind === "override" ? await rt.client.provider.inspection.listOverrides(contract.organizationId) : await rt.client.provider.inspection.listGrants(contract.organizationId);
        const entityId = text(body.entityId, "entityId");
        if (!entities.some(e => e.id === entityId)) throw new HttpError(400, "INVALID_ARGUMENT", "entitlement source does not belong to the contract organization");
        const evidence: ContractEvidence = { kind, entityId, note: text(body.note, "note", false, 2000) };
        if (body.documentId) evidence.documentId = uuid(text(body.documentId, "documentId"));
        if (body.page !== undefined) {
          if (!evidence.documentId || !Number.isSafeInteger(body.page) || body.page < 1) throw new HttpError(400, "INVALID_ARGUMENT", "page must be a positive integer and reference a PDF");
          evidence.page = body.page;
        }
        const event = audit(body.reason, "link_evidence");
        send(res, 200, await store.change(id, c => {
          if (evidence.documentId && !c.documents.some(d => d.id === evidence.documentId)) throw new HttpError(400, "INVALID_ARGUMENT", "PDF does not belong to this contract");
          c.evidence.push(evidence); c.history.push(event);
        })); return true;
      }
    }
    throw new HttpError(405, "METHOD_NOT_ALLOWED", "unsupported contract operation");
  };
}
