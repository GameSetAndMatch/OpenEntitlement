import {useEffect,useRef,useState} from "react";
import type {Workspace,Save} from "./app.tsx";
import {tier as validTier,variant as validVariant,type Tier,type Value} from "../../../server/workspace/model.ts";
import {ValuesEditor} from "./fields.tsx";
import {FormField} from "../form.tsx";
import {identifierFromTitle,uniqueIdentifier,variantName} from "./identifier.ts";
import {formatValue,type Json} from "../api.ts";

/**
 * Create a tier in two steps: set its values against the Privilege Catalog, then review and create.
 * The tier is created with its standard variant, so it can be assigned right away.
 */
export function TierCreate({workspace:w,save,busy,onCancel,onCreated}:{workspace:Workspace;save:Save;busy:boolean;onCancel:()=>void;onCreated:(tierId:string)=>void}){
  const [step,setStep]=useState<"values"|"review">("values");
  const [name,setName]=useState(""),[id,setId]=useState(""),[idEdited,setIdEdited]=useState(false);
  const [values,setValues]=useState<Record<string,Value>>({}),[error,setError]=useState("");
  // The tier saved by this form, if its standard variant failed afterwards: retrying resumes instead of failing on the existing ID.
  const [savedTier,setSavedTier]=useState<string>();
  // Creation spans two saves; nothing in the form changes until both have finished.
  const [submitting,setSubmitting]=useState(false);
  // Each step replaces the form, so focus moves to the new step's heading.
  const heading=useRef<HTMLHeadingElement>(null),moved=useRef(false);
  useEffect(()=>{if(!moved.current){moved.current=true;return;}heading.current?.focus();},[step]);
  const definitions=w.data.privileges.filter(p=>!p.hidden&&!w.data.features.find(f=>f.id===p.featureId)?.hidden);
  // The same rule as the server: a Privilege without a default needs a value in every variant.
  const missing=w.data.privileges.filter(p=>!Object.hasOwn(p,"default")&&!Object.hasOwn(values,p.key));
  function review(){
    if(id!==savedTier&&w.data.tiers.some(t=>t.id===id)){setError(`A tier with the ID ${id} already exists.`);return;}
    if(missing.length){setError(`Set a value for ${missing.map(p=>p.name).join(", ")}. ${missing.length===1?"It has":"They have"} no Catalog default.`);return;}
    setError("");setStep("review");
  }
  async function create(){
    const tier:Tier={id,name:name.trim(),rank:Math.max(-1,...w.data.tiers.map(t=>t.rank))+1,gracePeriodDays:0};
    const standardName=variantName(tier.name,"standard");
    const standard={id:uniqueIdentifier(standardName,"variant",w.data.variants.map(v=>v.id)),name:standardName,tierId:id,kind:"standard" as const,values};
    // Validate both records with the server's rules before saving either, so a tier is never left without its variant.
    try{validTier(tier);validVariant({...w.data,tiers:[...w.data.tiers.filter(t=>t.id!==id),tier]},standard);}catch(e){setError((e as Error).message);return;}
    setError("");setSubmitting(true);
    try{
      if(savedTier!==id){if(!await save("tiers",tier,"Create tier"))return;setSavedTier(id);}
      if(await save("variants",standard,"Create standard variant"))onCreated(id);
    }finally{setSubmitting(false);}
  }

  if(step==="review")return <section className="panel form" aria-labelledby="tier-review-title">
    <div className="form-header"><h2 id="tier-review-title" ref={heading} tabIndex={-1}>Review {name.trim()}</h2><p>Organizations on this tier get these values. Values you didn’t set follow the Privilege Catalog, including later changes to its defaults.</p></div>
    <div className="form-section"><table className="tier-review"><thead><tr><th>Privilege</th><th>Value</th><th>From</th></tr></thead><tbody>
      {definitions.map(p=>{const set=Object.hasOwn(values,p.key);const value=set?values[p.key]:p.default;return <tr key={p.key}><td><strong>{p.name}</strong><code>{p.key}</code></td><td>{value===undefined?"—":formatValue(value as Json)}</td><td>{set?"Set for this tier":"Catalog default"}</td></tr>;})}
    </tbody></table></div>
    {error&&<div className="form-section"><p role="alert" className="notice error">{error}</p></div>}
    <div className="form-actions"><button type="button" className="btn" disabled={busy||submitting} onClick={()=>setStep("values")}>Back</button><button type="button" className="btn primary" disabled={busy||submitting} onClick={()=>void create()}>Create tier</button></div>
  </section>;

  return <form className="panel form" onSubmit={e=>{e.preventDefault();review();}}>
    <div className="form-header"><h2 ref={heading} tabIndex={-1}>Create a tier</h2><p>A tier is an offer such as Basic, Pro or Enterprise. Set what it includes; everything else follows the Privilege Catalog.</p></div>
    <fieldset className="form-section"><legend>Tier</legend>
      <div className="form-grid">
        <FormField label="Name"><input required autoFocus disabled={Boolean(savedTier)} value={name} onChange={e=>{setName(e.target.value);if(!idEdited)setId(identifierFromTitle(e.target.value,"tier"));}}/></FormField>
        <FormField label="ID" hint={savedTier?"This tier is saved. Its standard variant still needs to be created.":"Filled from the name. It cannot change after saving."}><input className="mono" required disabled={Boolean(savedTier)} pattern="[a-z][a-z0-9_]*" maxLength={80} value={id} onChange={e=>{setIdEdited(e.target.value!=="");setId(e.target.value);}}/></FormField>
      </div>
    </fieldset>
    <fieldset className="form-section"><legend>What this tier includes</legend>
      <ValuesEditor environment={w.environment} frozenFeatures={w.data.features.filter(f=>f.frozen).map(f=>f.id)} definitions={definitions} base={{}} values={values} onChange={setValues}/>
    </fieldset>
    {error&&<div className="form-section"><p role="alert" className="notice error">{error}</p></div>}
    <div className="form-actions"><button type="button" className="btn" onClick={onCancel}>Cancel</button><button className="btn primary">Review tier</button></div>
  </form>;
}
