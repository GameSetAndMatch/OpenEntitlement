import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { actor, api, token, formatValue, type Meta, type Plan, type Details, type AuditEvent } from "./api.ts";
import { ReasonChip, Value, ValueInput, ReasonProvider, ToastProvider, useReason, useToast } from "./ui.tsx";
import { ContractsPanel } from "./contracts.tsx";
import "./style.css";
import { ConfigurationPanel } from "./configuration.tsx";
import { WorkspaceSetup } from "./setup.tsx";

type Organization = { organizationId: string; planId: string; overrides: number; grants: number };
type OrganizationDetails = { organizationId: string; assignment: { planId: string } | null; privileges: Details[]; overrides: any[]; grants: any[] };
function App() {
  const requestId = useRef(0);
  const [meta, setMeta] = useState<Meta>();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [selected, setSelected] = useState("");
  const [org, setOrg] = useState<OrganizationDetails>();
  const [tab, setTab] = useState("Organizations");
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [privilege, setPrivilege] = useState("projects.max");
  const [current, setCurrent] = useState(0);
  const [requested, setRequested] = useState(1);
  const [subject, setSubject] = useState("");
  const [result, setResult] = useState<any>();
  const [newPlan, setNewPlan] = useState("");
  const [connectionEpoch, setConnectionEpoch] = useState(0);
  const [settings, setSettings] = useState(false);
  const [adminToken, setAdminToken] = useState(token.get());
  const [who, setWho] = useState(actor.get() || "admin");
  const ask = useReason(), toast = useToast();
  const load = async () => {
    try {
      const m = await api<Meta>("GET", "/api/meta"); setMeta(m);
      if (m.capabilities.inspection) {
        const [p, o, a] = await Promise.all([api<Plan[]>("GET", "/api/plans"), api<Organization[]>("GET", "/api/organizations"), api<AuditEvent[]>("GET", "/api/audit?limit=50")]);
        setPlans(p); setOrgs(o); setEvents(a);
        setSelected(current => current || o[0]?.organizationId || "");
      }
      setError("");
    } catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  };
  const loadOrg = async () => {
    const id = ++requestId.current;
    if (!selected.trim()) { setOrg(undefined); setResult(undefined); return; }
    try {
      const data = await api<OrganizationDetails>("GET", `/api/organizations/${encodeURIComponent(selected)}`);
      if (subject) {
        const evaluated = await api<{ privileges: Details[] }>("POST", "/api/evaluate", { organizationId: selected, subjectId: subject });
        data.privileges = evaluated.privileges;
      }
      if (id === requestId.current) { setOrg(data); setResult(undefined); }
    } catch (e) { if (id === requestId.current) setError(String(e)); }
  };
  useEffect(() => { void load(); }, []);
  useEffect(() => { if (meta && selected) void loadOrg(); }, [selected, subject, meta]);
  async function mutate(title: string, method: string, path: string, body: any) {
    const reason = await ask(title); if (!reason) return;
    try { actor.set(who); await api(method, path, { ...body, reason }); await load(); await loadOrg(); toast("Change saved and audited"); }
    catch (e) { toast(String(e), "err"); }
  }
  async function check() {
    try { setResult(await api("POST", "/api/require", { organizationId: selected, ...(subject ? { subjectId: subject } : {}), privilege, current, requested })); }
    catch (e) { toast(String(e), "err"); }
  }
  const needsSetup = !loading && !error && meta?.capabilities.mutations && plans !== undefined && orgs.length === 0;
  return <div className="shell">
    <a className="skip-link" href="#workspace">Skip to workspace</a>
    <aside><a className="brand" href="/"><img src="/logo.svg" alt="" width="32" height="32"/><span>OpenEntitlement<small>Service console</small></span></a><div className="nav-label">WORKSPACE</div>{["Organizations", "Plans", "Audit", "Configuration"].map((t) => <button aria-current={tab === t ? "page" : undefined} aria-label={t} className={`nav ${tab === t ? "active" : ""}`} onClick={() => setTab(t)} key={t}>{t === "Organizations" ? "▦" : t === "Plans" ? "▤" : t === "Audit" ? "◷" : "{ }"} <span>{t}</span></button>)}<div className="sidebar-footer"><button className="btn" onClick={() => setSettings(!settings)}>Settings</button></div></aside>
    <main id="workspace" tabIndex={-1}><header><span>Workspace <span className="muted">/ {tab}</span></span><span className="badge">{meta?.provider.name === "in-memory" ? "Temporary workspace" : "Service console"}</span></header>
      {settings && <section className="panel settings"><h2>Settings</h2><dl className="service-details"><div><dt>Storage</dt><dd>{meta?.provider.name === "postgres" ? "PostgreSQL" : meta?.provider.name ?? "Not connected"}</dd></div><div><dt>Protocol</dt><dd>OEREP v1</dd></div><div><dt>Specification</dt><dd>{meta?.specVersion ?? "Not connected"}</dd></div></dl><h3>Connection</h3><label>Admin bearer token<input type="password" value={adminToken} onChange={(e) => setAdminToken(e.target.value)}/></label><label>Audit actor<input value={who} onChange={(e) => setWho(e.target.value)}/></label><button className="btn primary" onClick={() => { token.set(adminToken); actor.set(who); setConnectionEpoch(n => n + 1); setLoading(true); setSettings(false); void load(); }}>Connect</button></section>}
      <div className="page-heading"><div><h1>{tab}</h1><p>{tab === "Organizations" ? "See what each customer can do, and why." : tab === "Plans" ? "One catalog. Different limits for every agreement." : tab === "Audit" ? "Every change has an actor and a reason." : "Inspect your catalog and tier defaults as YAML."}</p></div><button className="btn" onClick={() => { void load(); void loadOrg(); }}>↻ Refresh</button></div>
      {error && <div role="alert" className="notice error">{error} <button onClick={() => setSettings(true)}>Configure connection</button></div>}
      {loading && <p role="status" className="notice">Loading workspace…</p>}
      {needsSetup && tab !== "Configuration" && meta && <WorkspaceSetup meta={meta} plans={plans} onComplete={async id => { setSelected(id); await load(); toast("Workspace ready. Your first organization is configured."); }}/>}
      {!needsSetup && !loading && tab === "Organizations" && <>
        <div className="org-grid">{orgs.map((o) => <button key={o.organizationId} onClick={() => setSelected(o.organizationId)} className={`org-card ${selected === o.organizationId ? "selected" : ""}`}><span className="avatar">{o.organizationId.slice(0, 2).toUpperCase()}</span><strong>{o.organizationId}</strong><span className="muted">{plans.find((p) => p.id === o.planId)?.name ?? o.planId}</span><small>{o.overrides ? `${o.overrides} override${o.overrides > 1 ? "s" : ""}` : o.grants ? `${o.grants} grants` : "Plan defaults"}</small></button>)}</div>
        <div className="panel toolbar"><label>Organization<input value={selected} onChange={(e) => setSelected(e.target.value)} /></label><label>Subject (optional)<input placeholder="Optional user or resource subject" value={subject} onChange={(e) => setSubject(e.target.value)} /></label>{meta?.capabilities.mutations && <label>Assigned plan<select value={org?.assignment?.planId ?? ""} onChange={(e) => void mutate("Change organization plan", "PUT", `/api/organizations/${encodeURIComponent(selected)}/plan`, { planId: e.target.value || null })}><option value="">No plan</option>{plans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>}</div>
        <div className="split"><section className="panel"><div className="section-title"><h2>Effective entitlements</h2><span className="muted">{selected}{subject && ` / ${subject}`}</span></div><table><thead><tr><th>Privilege</th><th>Effective value</th><th>Source</th></tr></thead><tbody>{org?.privileges.map((d) => <tr key={d.privilege}><td><code>{d.privilege}</code>{d.staleOverrides.length > 0 && <small className="amber">Stale override retained</small>}</td><td><Value v={d.value}/>{d.overrideId && <small className="muted">Plan: {formatValue(d.planValue)}</small>}</td><td><ReasonChip reason={d.reason}/></td></tr>)}</tbody></table></section>
        <section className="panel simulator"><div className="eyebrow">TRY A LIMIT</div><h2>Can this customer do more?</h2><p>Change usage and request a new unit to see the actual entitlement decision.</p><label>Privilege<select value={privilege} onChange={(e) => { setPrivilege(e.target.value); setResult(undefined); }}>{meta?.catalog.flatMap((f) => f.privileges).filter((p) => p.valueType === "integer").map((p) => <option key={p.key}>{p.key}</option>)}</select></label><div className="two-cols"><label>Current usage<input type="number" min="0" value={current} onChange={(e) => setCurrent(Number(e.target.value))}/></label><label>Requested<input type="number" step="1" value={requested} onChange={(e) => setRequested(Number(e.target.value))}/></label></div><button className="btn primary full" onClick={() => void check()}>Check entitlement</button>{result && <div role="status" className={`decision ${result.allowed ? "allowed" : "denied"}`}><strong>{result.allowed ? "Allowed" : "Limit reached"}</strong><p>{result.allowed ? `Request fits the ${formatValue(result.details.value)} limit.` : result.problem?.requiredPlan ? `Upgrade to ${result.problem.requiredPlan} to continue.` : "This request exceeds the current entitlement."}</p></div>}<div className="hint">This checks a limit without recording usage. Your application supplies the current usage and requested amount.</div></section></div>
        {meta?.capabilities.mutations && <div className="split extras"><ChangeForm kind="override" privileges={meta.catalog.flatMap((f) => f.privileges)} onSave={(data) => void mutate("Create negotiated override", "POST", `/api/organizations/${encodeURIComponent(selected)}/overrides`, data)}/><ChangeForm kind="grant" privileges={meta.catalog.flatMap((f) => f.privileges)} onSave={(data) => void mutate("Add quota grant", "POST", `/api/organizations/${encodeURIComponent(selected)}/grants`, data)}/></div>}
        {org && org.organizationId === selected && <ContractsPanel key={`${selected}:${connectionEpoch}`} organizationId={selected} overrides={org.overrides} grants={org.grants}/>}
      </>}
      {!needsSetup && tab === "Plans" && meta?.capabilities.mutations && <form className="panel toolbar" onSubmit={(e) => { e.preventDefault(); void mutate("Create plan", "PUT", `/api/plans/${encodeURIComponent(newPlan.trim())}`, { name: newPlan.trim() }); }}><label>New plan name<input required value={newPlan} onChange={(e) => setNewPlan(e.target.value)} placeholder="e.g. Team"/></label><button className="btn" disabled={!newPlan.trim()}>Create plan</button></form>}
      {!needsSetup && tab === "Plans" && <section className="panel overflow"><div className="section-title"><h2>Plan comparison</h2><span className="muted">Plan values before overrides and grants</span></div><table><thead><tr><th>Privilege</th>{plans.map((p) => <th key={p.id}>{p.name}</th>)}</tr></thead><tbody>{meta?.catalog.flatMap((f) => f.privileges).map((def) => <tr key={def.key}><td><code>{def.key}</code></td>{plans.map((p) => <td key={p.id}>{meta.capabilities.mutations ? <PlanValueEditor def={def} value={p.values[def.key]} onSave={(value) => void mutate("Update plan entitlement", "PUT", `/api/plans/${encodeURIComponent(p.id)}/values`, { values: { [def.key]: value } })}/> : <Value v={p.values[def.key]}/>}</td>)}</tr>)}</tbody></table></section>}
      {!needsSetup && tab === "Audit" && <section className="panel"><table><thead><tr><th>When</th><th>Actor</th><th>Change</th><th>Reason</th></tr></thead><tbody>{events.map((e, i) => <tr key={i}><td>{new Date(e.at).toLocaleString()}</td><td>{e.actor}</td><td><code>{e.action} {e.entity}</code><small className="muted">{e.entityId}</small></td><td>{e.reason}</td></tr>)}</tbody></table></section>}
      {tab === "Configuration" && !loading && !error && meta && <ConfigurationPanel meta={meta} plans={plans}/>}
      <footer>OpenEntitlement <span>Plans → overrides → grants. Every decision is explainable.</span></footer>
    </main>
  </div>;
}
function PlanValueEditor({ def, value, onSave }: { def: Meta["catalog"][number]["privileges"][number]; value: any; onSave: (value: any) => void }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const changed = JSON.stringify(draft) !== JSON.stringify(value);
  return <div><ValueInput def={def} value={draft} onChange={setDraft}/>{changed && <button className="btn" disabled={draft === undefined} onClick={() => onSave(draft)}>Save value</button>}</div>;
}
function ChangeForm({ kind, privileges, onSave }: { kind: "override" | "grant"; privileges: Meta["catalog"][number]["privileges"]; onSave: (data: any) => void }) {
  const defs = privileges.filter((p) => kind === "override" || p.valueType === "integer");
  const [key, setKey] = useState(defs[0]?.key ?? "");
  const def = defs.find((p) => p.key === key)!;
  const [value, setValue] = useState<any>(kind === "grant" ? 100 : def?.default);
  const [subjectId, setSubjectId] = useState("");
  return <section className="panel"><h2>{kind === "override" ? "Negotiate an override" : "Add a quota grant"}</h2><p>{kind === "override" ? "Replace the plan value for this organization. Bound to its current plan family." : "Add quota on top of the current plan. Grants survive plan changes."}</p><form onSubmit={(e) => { e.preventDefault(); onSave({ privilege: key, ...(kind === "grant" ? { amount: value } : { value }), ...(subjectId ? { subjectId } : {}) }); }}><div className="two-cols"><label>Privilege<select value={key} onChange={(e) => { setKey(e.target.value); setValue(kind === "grant" ? 100 : defs.find((p) => p.key === e.target.value)?.default); }}>{defs.map((p) => <option key={p.key}>{p.key}</option>)}</select></label><div className="value-field"><span>{kind === "grant" ? "Amount" : "Value"}</span>{kind === "grant" ? <input aria-label="Grant amount" type="number" required min="1" value={value} onChange={(e) => setValue(Number(e.target.value))}/> : def && <ValueInput def={def} value={value} onChange={setValue}/>}</div></div><label>Subject (optional)<input value={subjectId} onChange={(e) => setSubjectId(e.target.value)}/></label><button className="btn">{kind === "grant" ? "Add grant" : "Create override"}</button></form></section>;
}

createRoot(document.getElementById("root")!).render(<ToastProvider><ReasonProvider><App/></ReasonProvider></ToastProvider>);
