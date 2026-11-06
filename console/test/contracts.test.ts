import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { randomUUID } from "node:crypto";
import { configFromEnv } from "../server/config.ts";
import { startServer } from "../server/main.ts";
import type { Contract } from "../contracts.ts";

let service: Awaited<ReturnType<typeof startServer>>;
const pdf = Buffer.from("%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n%%EOF\n");
const headers = { authorization: "Bearer admin-contract-test", "content-type": "application/json", "x-oe-actor": "tester" };
before(async () => { service = await startServer({ ...configFromEnv(), provider: "memory", seedDemo: true, port: 0, adminToken: "admin-contract-test", evalToken: "eval-contract-test" }); });
after(async () => service?.close());
async function json(path: string, body?: unknown, method = body ? "POST" : "GET") {
  return fetch(service.url + path, { method, headers, ...(body ? { body: JSON.stringify(body) } : {}) });
}
async function create(organizationId = "acme"): Promise<Contract> {
  const r = await json("/api/contracts", { organizationId, title: "Customer MSA", reference: "MSA-42", externalReferences: [{ system: "stripe", reference: "sub_example" }], reason: "signed agreement" });
  assert.equal(r.status, 200); return r.json() as Promise<Contract>;
}
async function upload(c: Contract, content: Buffer = pdf, name = "agreement.pdf", type = "application/pdf") {
  return fetch(`${service.url}/api/contracts/${c.id}/documents?filename=${encodeURIComponent(name)}`, { method: "POST", headers: { ...headers, "content-type": type, "x-oe-reason": encodeURIComponent("signed PDF – customer copy") }, body: new Uint8Array(content) });
}

test("contract metadata and PDF routes reject evaluation/anonymous credentials; anonymous demos disable contracts", async () => {
  const c = await create();
  for (const path of ["/api/contracts?organizationId=acme", `/api/contracts/${c.id}`, `/api/contracts/${c.id}/documents/${randomUUID()}`]) {
    for (const token of ["", "eval-contract-test"]) {
      const r = await fetch(service.url + path, { headers: { authorization: `Bearer ${token}` } });
      assert.equal(r.status, 401);
    }
  }
  const anonymous = await startServer({ ...configFromEnv(), provider: "memory", seedDemo: false, port: 0, adminToken: undefined, evalToken: undefined });
  try { assert.equal((await fetch(anonymous.url + "/api/contracts?organizationId=acme")).status, 503); }
  finally { await anonymous.close(); }
});

test("PDFs persist with metadata/hash/history and download only as authenticated attachments", async () => {
  const c = await create();
  const r = await upload(c); assert.equal(r.status, 200);
  const saved = await r.json() as Contract;
  assert.equal(saved.documents.length, 1);
  assert.match(saved.documents[0]!.sha256, /^[a-f0-9]{64}$/);
  assert.equal(saved.history.at(-1)?.actor, "tester");
  assert.equal(saved.history.at(-1)?.reason, "signed PDF – customer copy");
  const d = await json(`/api/contracts/${c.id}/documents/${saved.documents[0]!.id}`);
  assert.equal(d.status, 200);
  assert.match(d.headers.get("content-disposition")!, /^attachment;/);
  assert.equal(d.headers.get("cache-control"), "no-store");
  assert.equal(d.headers.get("x-content-type-options"), "nosniff");
  assert.deepEqual(Buffer.from(await d.arrayBuffer()), pdf);
  const other = await create();
  assert.equal((await json(`/api/contracts/${other.id}/documents/${saved.documents[0]!.id}`)).status, 404);
});

test("evidence validates organization/document ownership and page numbers without changing evaluation", async () => {
  const c = await create();
  const uploaded = await (await upload(c)).json() as Contract;
  const acme = await (await json("/api/organizations/acme")).json() as any;
  const umbrella = await (await json("/api/organizations/umbrella")).json() as any;
  const body = { kind: "override", entityId: acme.overrides[0].id, documentId: uploaded.documents[0]!.id, page: 4, note: "Section 4.2, seat allowance", reason: "record provenance" };
  assert.equal((await json(`/api/contracts/${c.id}/evidence`, { ...body, page: 0 })).status, 400);
  assert.equal((await json(`/api/contracts/${c.id}/evidence`, { ...body, page: 1.5 })).status, 400);
  assert.equal((await json(`/api/contracts/${c.id}/evidence`, { ...body, entityId: umbrella.overrides[0].id })).status, 400);
  assert.equal((await json(`/api/contracts/${c.id}/evidence`, { ...body, documentId: randomUUID() })).status, 400);
  const linked = await json(`/api/contracts/${c.id}/evidence`, body);
  assert.equal(linked.status, 200);
  assert.equal(((await linked.json()) as Contract).evidence[0]!.page, 4);
  const updated = await json(`/api/contracts/${c.id}`, { title: c.title, status: "terminated", reason: "agreement ended" }, "PATCH");
  assert.equal(updated.status, 200);
  const evaluated = await (await json("/api/organizations/acme")).json() as any;
  assert.deepEqual(evaluated.privileges, acme.privileges);
  const listed = await (await json("/api/contracts?organizationId=acme")).json() as Contract[];
  assert.ok(listed.some(item => item.id === c.id));
  assert.deepEqual(await (await json("/api/contracts?organizationId=unrelated")).json(), []);
});

test("reject invalid metadata, missing reasons, invalid PDFs and oversized uploads", async () => {
  const c = await create();
  assert.equal((await json("/api/contracts", { title: "No customer", reason: "test" })).status, 400);
  assert.equal((await json("/api/contracts", { organizationId: "acme", title: "Missing reason" })).status, 400);
  assert.equal((await json("/api/contracts", { organizationId: "acme", title: "Invalid dates", startsAt: "2026-11-04T00:00:00Z", endsAt: "2026-11-01T00:00:00Z", reason: "test" })).status, 400);
  assert.equal((await upload(c, pdf, "a.pdf", "text/html")).status, 415);
  assert.equal((await upload(c, Buffer.from("<script>bad</script>"))).status, 422);
  assert.equal((await upload(c, pdf, "a.html")).status, 400);
  assert.equal((await upload(c, Buffer.alloc(10 * 1024 * 1024 + 1))).status, 413);
  assert.equal((await json("/api/contracts/not-a-uuid")).status, 400);
  assert.equal(((await (await json(`/api/contracts/${c.id}`)).json()) as Contract).documents.length, 0);
});

test("PostgreSQL contract metadata, PDF bytes and audit history survive service restart", { skip: !process.env.OE_PG_DSN }, async () => {
  const cfg = { ...configFromEnv(), provider: "postgres", databaseUrl: process.env.OE_PG_DSN, seedDemo: false, port: 0, adminToken: "admin-contract-test", evalToken: "eval-contract-test" };
  let running = await startServer(cfg);
  const org = `contract-test-${randomUUID()}`;
  let contract: Contract;
  try {
    const created = await fetch(running.url + "/api/contracts", { method: "POST", headers, body: JSON.stringify({ organizationId: org, title: "Persistence test", reason: "test" }) });
    assert.equal(created.status, 200); contract = await created.json() as Contract;
    const uploaded = await fetch(`${running.url}/api/contracts/${contract.id}/documents?filename=test.pdf`, { method: "POST", headers: { ...headers, "content-type": "application/pdf", "x-oe-reason": "test" }, body: pdf });
    assert.equal(uploaded.status, 200); contract = await uploaded.json() as Contract;
    // Concurrent writers must retain both documents and both audit entries.
    await Promise.all([1, 2].map(async n => {
      const result = await fetch(`${running.url}/api/contracts/${contract.id}/documents?filename=${n}.pdf`, { method: "POST", headers: { ...headers, "content-type": "application/pdf", "x-oe-reason": "parallel-test" }, body: pdf });
      assert.equal(result.status, 200);
    }));
    await running.close(); running = await startServer(cfg);
    const loaded = await (await fetch(`${running.url}/api/contracts/${contract.id}`, { headers })).json() as Contract;
    assert.equal(loaded.documents.length, 3); assert.equal(loaded.history.length, 4);
    const bytes = await fetch(`${running.url}/api/contracts/${contract.id}/documents/${loaded.documents[0]!.id}`, { headers });
    assert.deepEqual(Buffer.from(await bytes.arrayBuffer()), pdf);
  } finally { await running.close(); }
});
