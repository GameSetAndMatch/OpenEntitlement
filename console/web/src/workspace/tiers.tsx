import {useEffect,useRef,useState} from "react";
import {useUnsavedChanges} from "./unsaved.ts";
import type {Workspace,Save} from "./app.tsx";
import type {Tier,Variant} from "../../../server/workspace/model.ts";
import {ValuesEditor} from "./fields.tsx";
import {FormField} from "../form.tsx";
import {StatusPolicy} from "./status-policy.tsx";
import {identifierFromTitle} from "./identifier.ts";
import {TierCreate} from "./tier-create.tsx";
import {uniqueIdentifier,variantName} from "./identifier.ts";

const purpose=(kind:Variant["kind"])=>kind==="grace"?"Grace period":kind==="trial"?"Trial":"Standard";

export function Tiers({workspace:w,save,canEdit,busy}:{workspace:Workspace;save:Save;canEdit:boolean;busy:boolean}){
  const [tier,setTier]=useState<Tier>(),[editingTier,setEditingTier]=useState(false),[tierIdEdited,setTierIdEdited]=useState(false);
  const [variant,setVariant]=useState<Variant>(),[editingVariant,setEditingVariant]=useState(false),[variantIdEdited,setVariantIdEdited]=useState(false);
  // Creating a tier is a guided flow: values, review, then an offer to add a trial and a grace period.
  const [creating,setCreating]=useState(false),[created,setCreated]=useState<string>(),[graceDays,setGraceDays]=useState(7);
  const open=Boolean(tier||variant||creating||created);
  useUnsavedChanges(Boolean(tier),tier);useUnsavedChanges(Boolean(variant),variant);
  // The "is ready" step replaces the form; move focus to it when it appears and when a variant form returns to it.
  const nextHeading=useRef<HTMLHeadingElement>(null);
  useEffect(()=>{if(created&&!variant)nextHeading.current?.focus();},[created,variant]);
  const tiers=w.data.tiers.slice().sort((a,b)=>a.rank-b.rank);
  if(!w.data.privileges.length)return <section className="panel empty-workspace"><h2>Define your privileges first</h2><p>Your Privilege Catalog supplies the defaults each tier inherits.</p><a className="btn primary" href="#catalog">Go to the Privilege Catalog</a></section>;

  // A new tier only needs a name. It ranks above the existing tiers; rank and grace are edited later, when they matter.
  function newTier(){setCreating(true);setTier(undefined);setVariant(undefined);}
  function addVariant(t:Tier,kind:Variant["kind"]){const name=variantName(t.name,kind==="grace"?"grace period":kind);setVariant({id:uniqueIdentifier(name,"variant",w.data.variants.map(v=>v.id)),name,tierId:t.id,kind,values:{}});setGraceDays(t.gracePeriodDays||7);setEditingVariant(false);setVariantIdEdited(false);setTier(undefined);}
  function editTier(t:Tier){setTier({...t});setEditingTier(true);setVariant(undefined);}
  const freeKinds=(t:Tier)=>(["standard","trial","grace"] as const).filter(k=>!w.data.variants.some(v=>v.tierId===t.id&&v.kind===k));
  function newVariant(t:Tier){setVariant({id:"",name:"",tierId:t.id,kind:freeKinds(t)[0]??"standard",values:{}});setGraceDays(t.gracePeriodDays||7);setEditingVariant(false);setVariantIdEdited(false);setTier(undefined);}
  function editVariant(v:Variant){setVariant(structuredClone(v));setEditingVariant(true);setTier(undefined);}

  const hasGrace=(id:string)=>w.data.variants.some(v=>v.tierId===id&&v.kind==="grace");
  // Grace days matter once the tier has a grace variant. A stored value stays visible (and editable back to 0) even without one.
  const showGrace=(id:string)=>hasGrace(id)||(w.data.tiers.find(t=>t.id===id)?.gracePeriodDays??0)>0;
  const tierForm=tier&&canEdit&&<form className="panel form" onSubmit={e=>{e.preventDefault();void save("tiers",tier,editingTier?"Update tier":"Create tier").then(ok=>{if(ok)setTier(undefined);});}}>
    <div className="form-header"><h2>{editingTier?`Edit ${tier.name}`:"Create a tier"}</h2><p>A tier is an offer such as Basic, Pro or Enterprise. Its variants hold the values.</p></div>
    <fieldset className="form-section"><legend>Tier</legend>
      <div className="form-grid">
        <FormField label="Name"><input required value={tier.name} onChange={e=>setTier({...tier,name:e.target.value,...(editingTier||tierIdEdited?{}:{id:identifierFromTitle(e.target.value,"tier")})})}/></FormField>
        <FormField label="ID" hint={editingTier?"It cannot change.":"Filled from the name. It cannot change after saving."}><input className="mono" required disabled={editingTier} pattern="[a-z][a-z0-9_]*" maxLength={80} value={tier.id} onChange={e=>{setTierIdEdited(e.target.value!=="");setTier({...tier,id:e.target.value});}}/></FormField>
        {editingTier&&<FormField label="Rank" hint="Higher ranks are higher tiers, used to suggest upgrades."><input type="number" required min={0} step={1} value={tier.rank} onChange={e=>setTier({...tier,rank:Number(e.target.value)})}/></FormField>}
        {editingTier&&showGrace(tier.id)&&<FormField label="Past-due grace period" hint={hasGrace(tier.id)?"Days a past-due Organization keeps this tier's grace values.":"Add a grace variant to this tier to use these days. Until then, past-due Organizations on this tier cannot be saved; set 0 to restrict them right away."}><input type="number" required min={0} max={365} step={1} value={tier.gracePeriodDays} onChange={e=>setTier({...tier,gracePeriodDays:Number(e.target.value)})}/></FormField>}
      </div>
    </fieldset>
    <div className="form-actions"><button type="button" className="btn" onClick={()=>setTier(undefined)}>Cancel</button><button className="btn primary" disabled={busy}>Save tier</button></div>
  </form>;

  const variantTier=variant&&w.data.tiers.find(t=>t.id===variant.tierId);
  const variantForm=variant&&canEdit&&<form className="panel form" onSubmit={e=>{e.preventDefault();void (async()=>{const t=w.data.tiers.find(x=>x.id===variant.tierId);let ok=await save("variants",variant,editingVariant?"Update variant":"Create variant");if(ok&&!editingVariant&&variant.kind==="grace"&&t&&t.gracePeriodDays!==graceDays)ok=await save("tiers",{...t,gracePeriodDays:graceDays},"Set grace period");if(ok)setVariant(undefined);})();}}>
    <div className="form-header"><h2>{editingVariant?`Edit ${variant.name}`:`Add a variant to ${variantTier?.name??"this tier"}`}</h2><p>A variant inherits the catalog defaults and replaces only the values that differ.</p></div>
    <fieldset className="form-section"><legend>Variant</legend>
      <div className="form-grid">
        <FormField label="Name"><input required value={variant.name} onChange={e=>setVariant({...variant,name:e.target.value,...(editingVariant||variantIdEdited?{}:{id:identifierFromTitle(e.target.value,"variant")})})}/></FormField>
        <FormField label="ID" hint={editingVariant?"It cannot change.":"Filled from the name. It cannot change after saving."}><input className="mono" required disabled={editingVariant} pattern="[a-z][a-z0-9_]*" maxLength={80} value={variant.id} onChange={e=>{setVariantIdEdited(e.target.value!=="");setVariant({...variant,id:e.target.value});}}/></FormField>
        <FormField label="Purpose" hint={editingVariant?"It cannot change.":"Grace values apply while an Organization is past due."}><select disabled={editingVariant} value={variant.kind} onChange={e=>setVariant({...variant,kind:e.target.value as Variant["kind"]})}>{(["standard","trial","grace"] as const).filter(k=>editingVariant||k===variant.kind||!w.data.variants.some(v=>v.tierId===variant.tierId&&v.kind===k)).map(k=><option key={k} value={k}>{purpose(k)}</option>)}</select></FormField>
        {!editingVariant&&variant.kind==="grace"&&<FormField label="Grace period (days)" hint="How long a past-due Organization keeps these values."><input type="number" required min={1} max={365} step={1} value={graceDays} onChange={e=>setGraceDays(Number(e.target.value))}/></FormField>}
      </div>
    </fieldset>
    <fieldset className="form-section"><legend>Values</legend>
      <ValuesEditor environment={w.environment} frozenFeatures={w.data.features.filter(f=>f.frozen).map(f=>f.id)} definitions={w.data.privileges.filter(p=>!p.hidden&&!w.data.features.find(f=>f.id===p.featureId)?.hidden)} base={{}} values={variant.values} onChange={values=>setVariant({...variant,values})}/>
    </fieldset>
    <div className="form-actions"><button type="button" className="btn" onClick={()=>setVariant(undefined)}>Cancel</button><button className="btn primary" disabled={busy}>Save variant</button></div>
  </form>;

  return <>
    {canEdit&&tiers.length>0&&!open&&<div className="workspace-actions"><button className="btn primary" onClick={newTier}>Create tier</button></div>}
    {creating&&canEdit&&<TierCreate workspace={w} save={save} busy={busy} onCancel={()=>setCreating(false)} onCreated={id=>{setCreating(false);setCreated(id);}}/>}
    {created&&!variant&&(()=>{const t=w.data.tiers.find(x=>x.id===created);if(!t)return null;const has=(k:Variant["kind"])=>w.data.variants.find(v=>v.tierId===t.id&&v.kind===k);
      return <section className="panel form tier-next" aria-labelledby="tier-next-title"><div className="form-header"><h2 id="tier-next-title" ref={nextHeading} tabIndex={-1}>{t.name} is ready</h2><p>Organizations you assign to {t.name} get its standard values. You can also offer a free trial, and keep access for a while when a payment is late.</p></div>
        <div className="form-section"><ul className="tier-next-list">{(["trial","grace"] as const).map(k=>{const v=has(k);return <li key={k}><div><strong>{k==="trial"?"Free trial":"Grace period"}</strong><small>{v?`Added: ${v.name}${k==="grace"?` · ${t.gracePeriodDays} days`:""}`:k==="trial"?"Values while an Organization tries this tier.":"Values while a payment is late, for a set number of days."}</small></div>{!v&&<button className="btn" onClick={()=>addVariant(t,k)}>{k==="trial"?"Add a free trial":"Add a grace period"}</button>}</li>;})}</ul></div>
        <div className="form-actions"><button className="btn primary" onClick={()=>setCreated(undefined)}>Done</button></div></section>;})()}
    {tierForm}{variantForm}
    {!tiers.length&&!open&&<section className="panel empty-workspace"><h2>Create your first tier</h2><p>Tiers such as Basic, Pro and Enterprise share the same catalog. Each tier holds one or more variants with its values.</p>{canEdit&&<button className="btn primary" onClick={newTier}>Create tier</button>}</section>}
    {!open&&tiers.map(t=><section className="panel tier-panel" key={t.id}>
      <div className="section-title"><div><h2>{t.name}</h2>{showGrace(t.id)&&<p>{t.gracePeriodDays} days of past-due grace{!hasGrace(t.id)&&" · add a grace variant to use them"}</p>}</div>{canEdit&&<button className="btn" onClick={()=>editTier(t)}>Edit tier</button>}</div>
      {w.data.variants.filter(v=>v.tierId===t.id).map(v=><div className="variant-row" key={v.id}><div><strong>{v.name}</strong><small>{purpose(v.kind)} · {Object.keys(v.values).length} explicit values</small></div>{canEdit&&<button className="btn" onClick={()=>editVariant(v)}>Edit {v.name}</button>}</div>)}
      {!w.data.variants.some(v=>v.tierId===t.id)&&<p className="empty-note">Add a variant before assigning this tier to an Organization.</p>}
      {canEdit&&freeKinds(t).length>0&&<div className="panel-footer"><button className="btn-link" onClick={()=>newVariant(t)} aria-label={`Add a variant to ${t.name}`}>+ Add variant</button></div>}
    </section>)}
    {canEdit&&!open&&tiers.length>0&&<div className="settings-page tier-policy"><StatusPolicy key={JSON.stringify(w.data.statusPolicy)} workspace={w} save={save} busy={busy}/></div>}
  </>;
}
