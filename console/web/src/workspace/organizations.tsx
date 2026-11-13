import { useState } from "react";
import type { Workspace,Save } from "./app.tsx";
import { type Organization } from "../../../server/workspace/model.ts";
import {EffectiveEntitlements, SubjectEntitlements} from "./subjects.tsx";
import { ValuesEditor } from "./fields.tsx";
import { FormField } from "../form.tsx";
import { identifierFromTitle } from "./identifier.ts";
export function Organizations({workspace:w,save,canEdit,busy}:{workspace:Workspace;save:Save;canEdit:boolean;busy:boolean}){
  // An archived Tier keeps its Organizations but is given to no other one (ADR-0008).
  const archived=(tierId:string)=>Boolean((w.data.tiers.find(t=>t.id===tierId) as {archivedAt?:string}|undefined)?.archivedAt);
  const offered=(current?:string)=>w.data.variants.filter(v=>v.kind!=="grace"&&(v.id===current||!archived(v.tierId)));
  const fresh=():Organization=>({id:"",name:"",variantId:offered()[0]?.id??"",terms:{},status:"active"});
  const [draft,setDraft]=useState<Organization>(fresh),[show,setShow]=useState(false),[editing,setEditing]=useState(false),[idEdited,setIdEdited]=useState(false),[selected,setSelected]=useState(""),[userForm,setUserForm]=useState(false);
  // The saved Organization being edited: switching back to its variant before saving restores its terms.
  const [saved,setSaved]=useState<Organization>();
  const assigned=w.data.variants.find(v=>v.id===draft.variantId);
  const selectedOrg=w.data.organizations.find(o=>o.id===selected);
  if(!w.data.variants.length)return <section className="panel empty-workspace"><h2>Create a tier variant first</h2><p>Then assign that offer to your first Organization.</p><a className="btn primary" href="#tiers">Go to Tiers</a></section>;
  const definitions=w.data.privileges.filter(p=>!p.hidden&&!w.data.features.find(f=>f.id===p.featureId)?.hidden);
  function add(){setDraft(fresh());setSaved(undefined);setEditing(false);setIdEdited(false);setShow(true);}
  function edit(o:Organization){const current=structuredClone(o);if(!current.variantId)current.variantId=offered()[0]?.id??"";setDraft(current);setSaved(o.variantId?o:undefined);setEditing(true);setShow(true);}
  return <>{canEdit&&w.data.organizations.length>0&&!show&&!userForm&&<div className="workspace-actions"><button className="btn primary" onClick={add}>Add organization</button></div>}
    {show&&canEdit&&<form className="panel form" onSubmit={e=>{e.preventDefault();void save("organizations",draft,editing?"Update Organization terms":"Assign Organization tier").then(ok=>{if(ok){setShow(false);setSelected(draft.id);}});}}>
      <div className="form-header"><h2>{editing?`Edit ${draft.name}`:"Add an Organization"}</h2><p>An Organization is one of your customers. It gets a tier variant, and its own terms replace only the values that differ.</p></div>
      <fieldset className="form-section"><legend>Organization</legend>
        <div className="form-grid">
          <FormField label="Name"><input required value={draft.name} onChange={e=>setDraft({...draft,name:e.target.value,...(editing||idEdited?{}:{id:identifierFromTitle(e.target.value,"org")})})}/></FormField>
          <FormField label="ID" hint={editing?"Your application sends this ID. It cannot change.":"Filled from the name. Your application sends this ID, and it cannot change after saving."}><input className="mono" required disabled={editing} pattern="[a-z][a-z0-9_]*" maxLength={80} value={draft.id} onChange={e=>{setIdEdited(e.target.value!=="");setDraft({...draft,id:e.target.value});}}/></FormField>
          <FormField label="Tier variant" hint={editing&&saved?"Changing it clears this Organization's terms below. Switching back before saving keeps them.":undefined}><select value={draft.variantId} onChange={e=>setDraft({...draft,variantId:e.target.value,terms:saved&&e.target.value===saved.variantId?structuredClone(saved.terms):{}})}>{offered(saved?.variantId).map(v=><option value={v.id} key={v.id}>{v.name}</option>)}</select></FormField>
          <FormField label="Contract status"><select value={draft.status} onChange={e=>setDraft({...draft,status:e.target.value as Organization["status"]})}><option value="active">Active</option><option value="past_due">Past due</option><option value="ended">Ended</option></select></FormField>
        </div>
      </fieldset>
      <fieldset className="form-section"><legend>Own terms <span className="optional">Optional</span></legend>
        <p className="section-hint">Leave a value inherited, or replace it for this Organization only.</p>
        <ValuesEditor definitions={definitions} environment={w.environment} frozenFeatures={w.data.features.filter(f=>f.frozen).map(f=>f.id)} base={assigned?.values??{}} values={draft.terms} onChange={terms=>setDraft({...draft,terms})}/>
      </fieldset>
      <div className="form-actions"><button type="button" className="btn" onClick={()=>setShow(false)}>Cancel</button><button className="btn primary" disabled={busy}>Save organization</button></div>
    </form>}
    {!w.data.organizations.length&&!show&&<section className="panel empty-workspace"><h2>Add your first customer</h2><p>An Organization gets a tier variant. Its own terms replace only the values that differ.</p>{canEdit&&<button className="btn primary" onClick={add}>Add organization</button>}</section>}
    {!show&&!userForm&&<div className="workspace-list">{w.data.organizations.map(o=><button className="workspace-card" key={o.id} aria-pressed={selected===o.id} onClick={()=>setSelected(o.id)}><strong>{o.name}</strong><small>{o.variantId?<>{w.data.variants.find(v=>v.id===o.variantId)?.name} · {o.status==="past_due"?"Past due":o.status==="ended"?"Ended":"Active"}</>:"No tier in this Product"}</small></button>)}</div>}
    {!show&&!userForm&&selectedOrg&&<section className="panel overflow"><div className="section-title"><h2>{selectedOrg.name}</h2>{canEdit&&<button className="btn" onClick={()=>edit(selectedOrg)}>Edit organization</button>}</div>{selectedOrg.variantId?<EffectiveEntitlements workspace={w} organizationId={selectedOrg.id}/>:<p>This Organization has no tier in this Product yet.</p>}</section>}
    {!show&&selectedOrg&&!w.organizationValues&&<SubjectEntitlements key={selectedOrg.id} workspace={w} organizationId={selectedOrg.id} save={save} canEdit={canEdit} busy={busy} onFormChange={setUserForm}/>}
  </>;
}
