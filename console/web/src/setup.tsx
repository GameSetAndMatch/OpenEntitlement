import { useState } from "react";
import { api, type Meta, type Plan } from "./api.ts";
import { ValueInput, useReason } from "./ui.tsx";

/** Setup uses the same audited administration API as the rest of the console. */
export function WorkspaceSetup({ meta, plans, onComplete }: { meta: Meta; plans: Plan[]; onComplete: (organizationId: string) => Promise<void> }) {
  const [step, setStep] = useState(plans.length ? 2 : 1);
  const [planId, setPlanId] = useState(plans[0]?.id ?? "");
  const [name, setName] = useState("");
  const [org, setOrg] = useState("");
  const [values, setValues] = useState<Record<string, unknown>>(() => Object.fromEntries(meta.catalog.flatMap(f => f.privileges).map(p => [p.key, plans[0]?.values[p.key] ?? p.default])));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const ask = useReason();
  async function run(title: string, action: (reason: string) => Promise<void>) {
    const reason = await ask(title); if (!reason) return;
    setBusy(true); setError("");
    try { await action(reason); }
    catch (e) { setError(`${String(e)}. Your saved changes are retained. You can retry this step.`); }
    finally { setBusy(false); }
  }
  return <section className="setup panel" aria-labelledby="setup-title">
    <div className="setup-intro"><img className="setup-mark" src="/logo.svg" alt="" width="40" height="40"/><div><h2 id="setup-title">Set up your workspace</h2><p>Create your first plan and decide what a customer can use. This instance has no sample customers.</p></div></div>
    <ol className="setup-steps" aria-label="Setup progress">{["Create a plan", "Review entitlements", "Add an organization"].map((title, i) => <li key={title} aria-current={step === i + 1 ? "step" : undefined}><span aria-hidden="true">{step > i + 1 ? "✓" : i + 1}</span>{title}</li>)}</ol>
    {meta.provider.name === "in-memory" && <p className="storage-note">This is a temporary workspace. Changes are lost when the service restarts.</p>}
    {error && <p role="alert" className="notice error">{error}</p>}
    {step === 1 && <form onSubmit={e => { e.preventDefault(); void run("Create first plan", async reason => { await api("PUT", `/api/plans/${encodeURIComponent(planId.trim())}`, { name: name.trim(), reason }); setStep(2); }); }}>
      <h3>Create your first plan</h3><p>A plan is a reusable offer. Customer-specific exceptions can be added later.</p>
      <div className="two-cols"><label>Plan name<input name="planName" required maxLength={120} autoComplete="off" value={name} onChange={e => setName(e.target.value)} placeholder="For example, Team"/></label><label>Plan ID<input name="planId" required pattern="[a-z0-9][a-z0-9_-]*" maxLength={80} autoComplete="off" spellCheck={false} value={planId} onChange={e => setPlanId(e.target.value)} placeholder="team"/><small>Stable identifier used by your application. Lowercase letters, numbers, underscores or hyphens.</small></label></div>
      <button className="btn primary" disabled={busy}>{busy ? "Creating…" : "Create plan"}</button>
    </form>}
    {step === 2 && <form onSubmit={e => { e.preventDefault(); void run("Set initial plan entitlements", async reason => { await api("PUT", `/api/plans/${encodeURIComponent(planId)}/values`, { values, reason }); setStep(3); }); }}>
      <h3>Review what the plan includes</h3><p>These feature definitions come from the catalog configured on your server. Set limits for <strong>{name || plans.find(p => p.id === planId)?.name || planId}</strong> before assigning a customer.</p>
      {plans.length > 1 && <label>Plan<select value={planId} onChange={e => { const p = plans.find(p => p.id === e.target.value)!; setPlanId(p.id); setValues(Object.fromEntries(meta.catalog.flatMap(f => f.privileges).map(d => [d.key, p.values[d.key] ?? d.default]))); }}>{plans.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>}
      <div className="setup-values">{meta.catalog.map(f => <fieldset key={f.code}><legend>{f.name}</legend>{f.description && <p>{f.description}</p>}{f.privileges.map(def => <div className="setup-value" key={def.key}><div><code>{def.key}</code><small>{def.valueType === "integer" ? "Usage limit" : def.valueType === "boolean" ? "Feature access" : "Available option"}</small></div><ValueInput def={def} value={values[def.key]} onChange={value => setValues(v => ({ ...v, [def.key]: value }))}/></div>)}</fieldset>)}</div>
      <button className="btn primary" disabled={busy}>{busy ? "Saving…" : "Save entitlements"}</button>
    </form>}
    {step === 3 && <form onSubmit={e => { e.preventDefault(); void run("Assign first organization", async reason => { const id = org.trim(); await api("PUT", `/api/organizations/${encodeURIComponent(id)}/plan`, { planId, reason }); await onComplete(id); }); }}>
      <h3>Add your first organization</h3><p>Use the same organization ID your application sends when evaluating entitlements. It will be assigned to <strong>{name || plans.find(p => p.id === planId)?.name || planId}</strong>.</p>
      <label>Organization ID<input name="organizationId" required autoComplete="off" maxLength={200} spellCheck={false} value={org} onChange={e => setOrg(e.target.value)} placeholder="For example, your-company"/></label>
      <div className="row"><button type="button" className="btn" disabled={busy} onClick={() => setStep(2)}>Back to entitlements</button><button className="btn primary" disabled={busy}>{busy ? "Saving…" : "Open workspace"}</button></div>
    </form>}
    <details className="setup-help"><summary>Using your own catalog or trying the demo</summary><p>The included catalog contains example feature definitions, but no customer data. For your product, mount a catalog file and configure <code>OE_CATALOG</code> before creating plans. Feature definitions stay owned by your application.</p><p>To explore the sample plans and organizations instead, run a separate disposable instance with <code>OE_SEED=demo</code>. It is an explicit demo option, not a setup step.</p></details>
  </section>;
}
