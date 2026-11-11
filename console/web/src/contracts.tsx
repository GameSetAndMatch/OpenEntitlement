import { useEffect, useState } from "react";
import type { Contract } from "../../contracts.ts";
import { api, documentRequest, token } from "./api.ts";
import { useReason, useToast } from "./ui.tsx";

type Entity = { id: string; privilege: string };
export function ContractsPanel({ organizationId, overrides, grants }: { organizationId: string; overrides: Entity[]; grants: Entity[] }) {
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [error, setError] = useState("");
  const [title, setTitle] = useState("");
  const [reference, setReference] = useState("");
  const [system, setSystem] = useState("");
  const [externalReference, setExternalReference] = useState("");
  const [busy, setBusy] = useState(false);
  const ask = useReason(), toast = useToast();
  const path = "/api/contracts?organizationId=" + encodeURIComponent(organizationId);
  const reload = async () => setContracts(await api<Contract[]>("GET", path));
  useEffect(() => {
    let active = true;
    api<Contract[]>("GET", path).then(data => { if (active) { setContracts(data); setError(""); } }).catch(e => { if (active) setError(String(e)); });
    return () => { active = false; };
  }, [path]);
  const change = async (label: string, action: (reason: string) => Promise<unknown>) => {
    const reason = await ask(label); if (!reason) return;
    setBusy(true);
    try { await action(reason); await reload(); toast("Contract change saved and recorded"); }
    catch (e) { toast(String(e), "err"); }
    finally { setBusy(false); }
  };
  return <section className="panel contracts-panel"><div className="section-title"><h2>Contracts &amp; source documents</h2><span className="muted">{organizationId}</span></div>
    <p>Link negotiated entitlements to the agreement behind them. Documents and contract dates do not change entitlement values.</p>
    {error && <p role="alert" className="notice error">{error}. Contracts require a server configured with an admin token. Enter that token in Settings.</p>}
    {!token.get() && !error && <p className="notice">Connect with an admin token to manage private contracts.</p>}
    {!error && <>
      <form className="contract-create" onSubmit={e => { e.preventDefault(); void change("Create customer contract", async reason => {
        await api("POST", "/api/contracts", { organizationId, title, reference, externalReferences: system && externalReference ? [{ system, reference: externalReference }] : [], reason });
        setTitle(""); setReference(""); setSystem(""); setExternalReference("");
      }); }}>
        <div className="two-cols"><label>Agreement title<input required maxLength={500} value={title} onChange={e => setTitle(e.target.value)}/></label><label>Contract reference<input maxLength={500} value={reference} onChange={e => setReference(e.target.value)}/></label></div>
        <div className="two-cols"><label>External system (optional)<input value={system} onChange={e => setSystem(e.target.value)} maxLength={80}/></label><label>External reference<input value={externalReference} onChange={e => setExternalReference(e.target.value)} maxLength={500}/></label></div>
        <button className="btn" disabled={busy || !title.trim() || Boolean(system.trim()) !== Boolean(externalReference.trim())}>Create contract</button>
      </form>
      {!contracts.length && <p className="muted">No contracts for this organization yet.</p>}
      {contracts.map(c => <ContractCard key={c.id} contract={c} overrides={overrides} grants={grants} busy={busy} change={change}/>)}
    </>}
  </section>;
}
function ContractCard({ contract: c, overrides, grants, busy, change }: { contract: Contract; overrides: Entity[]; grants: Entity[]; busy: boolean; change: (label: string, action: (reason: string) => Promise<unknown>) => Promise<void> }) {
  const [file, setFile] = useState<File>();
  const [entity, setEntity] = useState("");
  const [documentId, setDocumentId] = useState("");
  const [page, setPage] = useState("");
  const [note, setNote] = useState("");
  const [status, setStatus] = useState(c.status);
  const [start, setStart] = useState(c.startsAt?.slice(0, 10) ?? "");
  const [end, setEnd] = useState(c.endsAt?.slice(0, 10) ?? "");
  const toast = useToast();
  const path = "/api/contracts/" + c.id;
  const entities = [...overrides.map(e => ({ ...e, kind: "override" })), ...grants.map(e => ({ ...e, kind: "grant" }))];
  const download = async (id: string, filename: string) => {
    try {
      const response = await documentRequest(`${path}/documents/${id}`);
      const url = URL.createObjectURL(await response.blob());
      const a = document.createElement("a"); a.href = url; a.download = filename; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) { toast(String(e), "err"); }
  };
  return <article className="contract-card"><h3>{c.title}</h3><p><strong>{c.reference || "No reference"}</strong> · {c.status}</p>
    {c.externalReferences.map((r, i) => <p key={i}><code>{r.system}</code>: {r.reference}</p>)}
    <form onSubmit={e => { e.preventDefault(); void change("Update contract record", reason => api("PATCH", path, { title: c.title, reference: c.reference, externalReferences: c.externalReferences, status, ...(start ? { startsAt: new Date(start).toISOString() } : {}), ...(end ? { endsAt: new Date(end).toISOString() } : {}), reason })); }}>
      <div className="two-cols"><label>Status<select value={status} onChange={e => setStatus(e.target.value as Contract["status"])}>{["draft", "active", "expired", "terminated"].map(s => <option key={s}>{s}</option>)}</select></label><label>Effective from (UTC)<input type="date" value={start} onChange={e => setStart(e.target.value)}/></label><label>Effective until (UTC)<input type="date" value={end} onChange={e => setEnd(e.target.value)}/></label></div>
      <button className="btn" disabled={busy}>Save contract dates / status</button>
    </form>
    <h4>PDF documents</h4><ul>{c.documents.map(d => <li key={d.id}><button className="btn ghost" onClick={() => void download(d.id, d.filename)}>Download {d.filename}</button><small className="muted">{Math.ceil(d.size / 1024)} KiB · SHA-256 {d.sha256.slice(0, 12)}…</small></li>)}</ul>
    <form onSubmit={e => { e.preventDefault(); if (file) void change("Attach private PDF", reason => documentRequest(`${path}/documents?filename=${encodeURIComponent(file.name)}`, "POST", file, reason)); }}>
      <label>Attach PDF (maximum 10 MiB)<input type="file" accept="application/pdf,.pdf" onChange={e => setFile(e.target.files?.[0])}/></label><button className="btn" disabled={busy || !file || file.size > 10 * 1024 * 1024}>Attach PDF</button>
    </form>
    <h4>Entitlement evidence</h4><ul>{c.evidence.map((e, i) => <li key={i}><strong>{e.kind}: {entities.find(item => item.id === e.entityId)?.privilege ?? e.entityId}</strong>{e.documentId && <span> · {c.documents.find(d => d.id === e.documentId)?.filename}{e.page && `, page ${e.page}`}</span>}<p>{e.note}</p></li>)}</ul>
    <form onSubmit={e => { e.preventDefault(); const chosen = entities.find(item => `${item.kind}:${item.id}` === entity); if (chosen) void change("Link entitlement evidence", reason => api("POST", `${path}/evidence`, { kind: chosen.kind, entityId: chosen.id, ...(documentId ? { documentId } : {}), ...(page ? { page: Number(page) } : {}), note, reason })); }}>
      <label>Override or grant<select required value={entity} onChange={e => setEntity(e.target.value)}><option value="">Select an existing entitlement source</option>{entities.map(item => <option key={`${item.kind}:${item.id}`} value={`${item.kind}:${item.id}`}>{item.kind}: {item.privilege} ({item.id.slice(0, 8)})</option>)}</select></label>
      <div className="two-cols"><label>Supporting PDF<select value={documentId} onChange={e => { setDocumentId(e.target.value); setPage(""); }}><option value="">Contract record only</option>{c.documents.map(d => <option key={d.id} value={d.id}>{d.filename}</option>)}</select></label><label>Page (optional)<input type="number" min={1} step={1} disabled={!documentId} value={page} onChange={e => setPage(e.target.value)}/></label></div>
      <label>Clause / note<textarea maxLength={2000} value={note} onChange={e => setNote(e.target.value)}/></label><button className="btn" disabled={busy || !entity}>Link evidence</button>
    </form>
    <details><summary>Contract history ({c.history.length})</summary><ul>{c.history.map((h, i) => <li key={i}>{h.at} · {h.actor} · {h.action}: {h.reason}</li>)}</ul></details>
  </article>;
}
