import {useState} from "react";
import type {Workspace,Save} from "./app.tsx";
import type {Tier,Variant} from "../../../server/workspace/model.ts";
import {ValuesEditor} from "./fields.tsx";
import {FormField} from "../form.tsx";
import {identifierFromTitle} from "./identifier.ts";

const purpose=(kind:Variant["kind"])=>kind==="grace"?"Grace period":kind==="trial"?"Trial":"Standard";

export function Tiers({workspace:w,save,canEdit,busy}:{workspace:Workspace;save:Save;canEdit:boolean;busy:boolean}){
  const [tier,setTier]=useState<Tier>(),[editingTier,setEditingTier]=useState(false),[tierIdEdited,setTierIdEdited]=useState(false);
  const [variant,setVariant]=useState<Variant>(),[editingVariant,setEditingVariant]=useState(false),[variantIdEdited,setVariantIdEdited]=useState(false);
  const open=Boolean(tier||variant);
  const tiers=w.data.tiers.slice().sort((a,b)=>a.rank-b.rank);
  if(!w.data.privileges.length)return <section className="panel empty-workspace"><h2>Define your privileges first</h2><p>Your Privilege Catalog supplies the defaults each tier inherits.</p><a className="btn primary" href="#catalog">Go to the Privilege Catalog</a></section>;

  // A new tier only needs a name. It ranks above the existing tiers; rank and grace are edited later, when they matter.
  function newTier(){setTier({id:"",name:"",rank:Math.max(-1,...w.data.tiers.map(t=>t.rank))+1,gracePeriodDays:0});setEditingTier(false);setTierIdEdited(false);setVariant(undefined);}
  function editTier(t:Tier){setTier({...t});setEditingTier(true);setVariant(undefined);}
  function newVariant(t:Tier){setVariant({id:"",name:"",tierId:t.id,kind:"standard",values:{}});setEditingVariant(false);setVariantIdEdited(false);setTier(undefined);}
  function editVariant(v:Variant){setVariant(structuredClone(v));setEditingVariant(true);setTier(undefined);}

  const hasGrace=(id:string)=>w.data.variants.some(v=>v.tierId===id&&v.kind==="grace");
  const tierForm=tier&&canEdit&&<form className="panel form" onSubmit={e=>{e.preventDefault();void save("tiers",tier,editingTier?"Update tier":"Create tier").then(ok=>{if(ok)setTier(undefined);});}}>
    <div className="form-header"><h2>{editingTier?`Edit ${tier.name}`:"Create a tier"}</h2><p>A tier is an offer such as Basic, Pro or Enterprise. Its variants hold the values.</p></div>
    <fieldset className="form-section"><legend>Tier</legend>
      <div className="form-grid">
        <FormField label="Name"><input required value={tier.name} onChange={e=>setTier({...tier,name:e.target.value,...(editingTier||tierIdEdited?{}:{id:identifierFromTitle(e.target.value,"tier")})})}/></FormField>
        <FormField label="ID" hint={editingTier?"It cannot change.":"Filled from the name. It cannot change after saving."}><input className="mono" required disabled={editingTier} pattern="[a-z][a-z0-9_]*" maxLength={80} value={tier.id} onChange={e=>{setTierIdEdited(e.target.value!=="");setTier({...tier,id:e.target.value});}}/></FormField>
        {editingTier&&<FormField label="Rank" hint="Higher ranks are higher tiers, used to suggest upgrades."><input type="number" required min={0} step={1} value={tier.rank} onChange={e=>setTier({...tier,rank:Number(e.target.value)})}/></FormField>}
        {editingTier&&hasGrace(tier.id)&&<FormField label="Past-due grace period" hint="Days a past-due Organization keeps this tier's grace values."><input type="number" required min={0} max={365} step={1} value={tier.gracePeriodDays} onChange={e=>setTier({...tier,gracePeriodDays:Number(e.target.value)})}/></FormField>}
      </div>
    </fieldset>
    <div className="form-actions"><button type="button" className="btn" onClick={()=>setTier(undefined)}>Cancel</button><button className="btn primary" disabled={busy}>Save tier</button></div>
  </form>;

  const variantTier=variant&&w.data.tiers.find(t=>t.id===variant.tierId);
  const variantForm=variant&&canEdit&&<form className="panel form" onSubmit={e=>{e.preventDefault();void save("variants",variant,editingVariant?"Update variant":"Create variant").then(ok=>{if(ok)setVariant(undefined);});}}>
    <div className="form-header"><h2>{editingVariant?`Edit ${variant.name}`:`Add a variant to ${variantTier?.name??"this tier"}`}</h2><p>A variant inherits the catalog defaults and replaces only the values that differ.</p></div>
    <fieldset className="form-section"><legend>Variant</legend>
      <div className="form-grid">
        <FormField label="Name"><input required value={variant.name} onChange={e=>setVariant({...variant,name:e.target.value,...(editingVariant||variantIdEdited?{}:{id:identifierFromTitle(e.target.value,"variant")})})}/></FormField>
        <FormField label="ID" hint={editingVariant?"It cannot change.":"Filled from the name. It cannot change after saving."}><input className="mono" required disabled={editingVariant} pattern="[a-z][a-z0-9_]*" maxLength={80} value={variant.id} onChange={e=>{setVariantIdEdited(e.target.value!=="");setVariant({...variant,id:e.target.value});}}/></FormField>
        <FormField label="Purpose" hint={editingVariant?"It cannot change.":"Grace values apply while an Organization is past due."}><select disabled={editingVariant} value={variant.kind} onChange={e=>setVariant({...variant,kind:e.target.value as Variant["kind"]})}><option value="standard">Standard</option><option value="trial">Trial</option><option value="grace">Grace period</option></select></FormField>
      </div>
    </fieldset>
    <fieldset className="form-section"><legend>Values</legend>
      <ValuesEditor environment={w.environment} frozenFeatures={w.data.features.filter(f=>f.frozen).map(f=>f.id)} definitions={w.data.privileges.filter(p=>!p.hidden&&!w.data.features.find(f=>f.id===p.featureId)?.hidden)} base={{}} values={variant.values} onChange={values=>setVariant({...variant,values})}/>
    </fieldset>
    <div className="form-actions"><button type="button" className="btn" onClick={()=>setVariant(undefined)}>Cancel</button><button className="btn primary" disabled={busy}>Save variant</button></div>
  </form>;

  return <>
    {canEdit&&tiers.length>0&&!open&&<div className="workspace-actions"><button className="btn primary" onClick={newTier}>Create tier</button></div>}
    {tierForm}{variantForm}
    {!tiers.length&&!open&&<section className="panel empty-workspace"><h2>Create your first tier</h2><p>Tiers such as Basic, Pro and Enterprise share the same catalog. Each tier holds one or more variants with its values.</p>{canEdit&&<button className="btn primary" onClick={newTier}>Create tier</button>}</section>}
    {!open&&tiers.map(t=><section className="panel tier-panel" key={t.id}>
      <div className="section-title"><div><h2>{t.name}</h2>{hasGrace(t.id)&&<p>{t.gracePeriodDays} days of past-due grace</p>}</div>{canEdit&&<button className="btn" onClick={()=>editTier(t)}>Edit tier</button>}</div>
      {w.data.variants.filter(v=>v.tierId===t.id).map(v=><div className="variant-row" key={v.id}><div><strong>{v.name}</strong><small>{purpose(v.kind)} · {Object.keys(v.values).length} explicit values</small></div>{canEdit&&<button className="btn" onClick={()=>editVariant(v)}>Edit {v.name}</button>}</div>)}
      {!w.data.variants.some(v=>v.tierId===t.id)&&<p className="empty-note">Add a variant before assigning this tier to an Organization.</p>}
      {canEdit&&<div className="panel-footer"><button className="btn-link" onClick={()=>newVariant(t)} aria-label={`Add a variant to ${t.name}`}>+ Add variant</button></div>}
    </section>)}
  </>;
}
