import { useEffect, useId, useRef } from "react";
import { valueError, type Privilege, type Value } from "../../../server/workspace/model.ts";
import type {EnvironmentOverrides} from "../../../server/environment.ts";
import {EnvironmentNotice, Toggle } from "../ui.tsx";

export function Field({def,value,onChange}: {def:Privilege;value:Value|undefined;onChange:(value:Value|undefined)=>void}) {
  const id=useId(),ref=useRef<HTMLInputElement>(null);
  const unlimited=typeof value==="object" && value?.unlimited===true;
  const previous=useRef<Value|undefined>(value??def.default);
  const error=value===undefined?"Enter a value":valueError(def,value);
  useEffect(()=>{ref.current?.setCustomValidity(error??"");},[error]);
  useEffect(()=>{if(typeof value!=="object" && value!==undefined)previous.current=value;},[value]);
  if(def.type==="boolean"&&value===undefined)return <select aria-label={def.key} required value="" onChange={e=>onChange(e.target.value==="true")}><option value="">Choose a value</option><option value="true">Enabled</option><option value="false">Disabled</option></select>;
  if(def.type==="boolean")return <Toggle checked={value===true} onChange={onChange} label={def.key}/>;
  if(def.type==="string" && def.enum)return <select required aria-label={def.key} value={typeof value==="string"?value:""} onChange={e=>onChange(e.target.value)}>{value===undefined&&<option value="">Choose a value</option>}{def.enum.map(v=><option key={v}>{v}</option>)}</select>;
  return <div className="int-input"><input ref={ref} aria-label={def.key} aria-invalid={Boolean(error)} aria-describedby={error?id:undefined} required={def.type==="integer"||value===undefined} type={def.type==="integer"&&!unlimited?"number":"text"} step={def.type==="integer"?1:undefined} value={unlimited?"∞":value===undefined?"":String(value)} disabled={unlimited} onChange={e=>onChange(def.type==="integer"?(e.target.value===""?undefined:Number(e.target.value)):e.target.value)}/>
    {error&&<small id={id} role="alert" className="field-error">{error}</small>}
    {def.type==="integer"&&def.unlimited&&<label className="unlimited-control"><input type="checkbox" checked={unlimited} aria-label={`Unlimited ${def.key}`} onChange={e=>onChange(e.target.checked?{unlimited:true}:typeof previous.current==="object"?def.minimum??0:previous.current??def.minimum??0)}/>Unlimited</label>}
  </div>;
}
export function ValuesEditor({definitions,base,values,onChange,environment={},frozenFeatures=[]}: {environment?:EnvironmentOverrides;frozenFeatures?:string[];definitions:Privilege[];base:Record<string,Value>;values:Record<string,Value>;onChange:(values:Record<string,Value>)=>void}) {
 return <div className="workspace-values">{definitions.map(def=>{
  const binding=Object.hasOwn(environment,def.key)?environment[def.key]:undefined;
  const defaultFrozen=Boolean(def.frozen||frozenFeatures.includes(def.featureId??""));
  const frozen=Boolean(binding||defaultFrozen);
  const required=!def.envVariable&&!Object.hasOwn(base,def.key)&&!Object.hasOwn(def,"default");
  const explicit=Object.hasOwn(values,def.key)||required||frozen,inherited=Object.hasOwn(base,def.key)?base[def.key]!:def.default;
  return <fieldset disabled={frozen} className={`setup-value ${frozen?"environment-frozen":""}`} key={def.key}><legend className="sr-only">{def.name}</legend><div><strong>{def.name}</strong><code>{def.key}</code><p>{def.description}</p><EnvironmentNotice binding={binding} frozen={frozen}/>{frozen?null:required?<small>Required in every tier variant</small>:<label className="unlimited-control"><input type="checkbox" checked={explicit} aria-label={`Override ${def.key}`} onChange={e=>{const next={...values};if(e.target.checked&&inherited!==undefined)next[def.key]=inherited;else delete next[def.key];onChange(next);}}/>Override inherited value</label>}</div><div>{explicit?<Field def={def} value={binding?(defaultFrozen?def.default:Object.hasOwn(values,def.key)?values[def.key]:inherited)===true&&binding.value:defaultFrozen?def.default:values[def.key]} onChange={v=>onChange({...values,[def.key]:v as Value})}/>:<div className="inherited-value"><strong>{inherited===undefined?"Required":typeof inherited==="object"?"∞":typeof inherited==="boolean"?(inherited?"Enabled":"Disabled"):String(inherited)}</strong><small>Inherited</small></div>}</div></fieldset>;
 })}</div>;
}
