import {useState} from 'react';
import {Field} from './fields.tsx';
import {TagPicker} from './tag-picker.tsx';
import {GroupPicker} from './group-picker.tsx';
import {ChoiceList,cleanChoices} from './choice-list.tsx';
import {identifierFromTitle} from './identifier.ts';
import {Check,FormField} from '../form.tsx';
import {storedDefinition} from '../../../server/workspace/catalog-adapter.ts';
import type {Privilege} from '../../../server/workspace/privilege-definition.ts';
import type {Group,Privilege as StoredPrivilege,Tag} from '../../../server/workspace/model.ts';
import type {Workspace} from './app.tsx';
import type {Value} from '../../../server/workspace/model.ts';
import {useUnsavedChanges} from './unsaved.ts';

/** A variant as the Privilege form needs it: requiring a value asks for the value of each variant that does not set its own. */
export interface VariantValues {id:string;name:string;values:Record<string,unknown>}

export const freshPrivilege=():Privilege=>({key:'',title:'',description:'',type:'boolean',visibility:'editable',tags:[],default:false});

/** The saved form of a draft: enum choices trimmed, blank rows dropped. */
function cleaned(draft:Privilege):Privilege{
 if(draft.type!=='enum')return draft;
 const choices=cleanChoices(draft.enum);
 return {...draft,enum:choices,...(Object.hasOwn(draft,'default')?{default:choices.includes(draft.default??'')?draft.default:choices[0]}:{})};
}

export function PrivilegeForm({initial,editing,groups,takenGroupIds,tags,variants=[],environment,envEditable,busy,onSave,onCreateTag,onCreateGroup,onCancel}:{
 initial:Privilege;editing:boolean;groups:Group[];takenGroupIds?:readonly string[];tags:Tag[];variants?:readonly VariantValues[];environment?:Workspace['environment'];envEditable:boolean;busy:boolean;
 /** `variantValues` holds the value of each existing variant when the Privilege has no Catalog default. Both save as one change. */
 onSave:(privilege:Privilege,variantValues?:Record<string,Value>)=>Promise<boolean>;onCreateTag:(tag:Tag)=>Promise<boolean>;onCreateGroup:(group:Group)=>Promise<boolean>;onCancel:()=>void;
}){
 const [draft,setDraft]=useState<Privilege>(initial),[keyEdited,setKeyEdited]=useState(false);
 const saved=cleaned(draft),binding=environment?.[draft.key];
 const requireValue=!Object.hasOwn(draft,'default');
 // One value for every variant by default; "Set per variant" expands it. Requiring a value starts from the default it replaces.
 const [shared,setShared]=useState<Value|undefined>(),[perVariant,setPerVariant]=useState<Record<string,Value|undefined>>();
 const missing=variants.filter(v=>!Object.hasOwn(v.values,draft.key)),asksVariants=requireValue&&missing.length>0;
 const variantValues=asksVariants?Object.fromEntries(missing.map(v=>[v.id,(perVariant?perVariant[v.id]:shared) as Value])):undefined;
 useUnsavedChanges(true,{draft,variantValues});
 function changeType(type:Privilege['type']){
  const common={key:draft.key,title:draft.title,description:draft.description,visibility:draft.visibility,groupId:draft.groupId,tags:draft.tags};
  setShared(undefined);setPerVariant(undefined);
  setDraft(type==='boolean'?{...common,type,default:false}:type==='integer'?{...common,type,default:0}:{...common,type,enum:['standard'],default:'standard'});
 }
 function setRequired(required:boolean){
  const next={...draft} as Privilege&{default?:unknown};
  // The value the variants used until now is the starting point for each of them.
  if(required){setShared(next.default as Value|undefined);setPerVariant(undefined);delete next.default;}
  else next.default=next.type==='boolean'?false:next.type==='integer'?next.minimum??0:cleanChoices(next.enum)[0]??'';
  setDraft(next as Privilege);
 }
 // Read-only and hidden values come from the Catalog default, so they always have one.
 const needsDefault=draft.visibility!=='editable';
 const defaultError=needsDefault&&requireValue?`A ${draft.visibility==='read_only'?'Read-only':'Hidden'} Privilege needs a Catalog default. Clear “Require a value in every Tier variant”.`:'';
 function changeVisibility(visibility:Privilege['visibility']){
  if(visibility==='editable'||!requireValue){setDraft({...draft,visibility});return;}
  const next={...draft,visibility} as Privilege&{default?:unknown};
  next.default=next.type==='boolean'?false:next.type==='integer'?next.minimum??0:cleanChoices(next.enum)[0]??'';
  setDraft(next as Privilege);
 }
 return <form className="panel form privilege-form" onSubmit={e=>{e.preventDefault();if(defaultError){e.currentTarget.querySelector<HTMLInputElement>('[data-require-value]')?.focus();return;}void (variantValues?onSave(saved,variantValues):onSave(saved));}}>
  <div className="form-header">
   <h2>{editing?`Edit ${initial.title}`:'Define a Privilege'}</h2>
   <p>A Privilege is one thing your product allows or limits, such as a feature or a quota.</p>
  </div>

  <fieldset className="form-section">
   <legend>Basics</legend>
   <div className="form-grid">
    <FormField label="Title">
     <input required maxLength={200} value={draft.title} onChange={e=>setDraft({...draft,title:e.target.value,...(editing||keyEdited?{}:{key:identifierFromTitle(e.target.value,'privilege')})})}/>
    </FormField>
    <FormField label="Key" hint={editing?'Used by your application. It cannot change.':'Filled from the title. Your application uses it, and it cannot change after saving.'}>
     <input className="mono" required disabled={editing} pattern="[a-z][a-z0-9_]*" maxLength={80} value={draft.key} onChange={e=>{setKeyEdited(e.target.value!=='');setDraft({...draft,key:e.target.value});}}/>
    </FormField>
   </div>
   <FormField label="Description" optional>
    <textarea rows={2} maxLength={2000} value={draft.description} onChange={e=>setDraft({...draft,description:e.target.value})}/>
   </FormField>
  </fieldset>

  <fieldset className="form-section">
   <legend>Value</legend>
   <div className="form-grid">
    <FormField label="Value type">
     <select value={draft.type} onChange={e=>changeType(e.target.value as Privilege['type'])}><option value="boolean">Boolean (on or off)</option><option value="integer">Integer (a limit)</option><option value="enum">String enum (one of a list)</option></select>
    </FormField>
    <FormField label="Visibility" hint={draft.visibility==='editable'?'Tiers and Organizations can set their own value.':draft.visibility==='read_only'?'Everyone gets the catalog default.':'Not shown in the console. It still evaluates.'}>
     <select value={draft.visibility} onChange={e=>changeVisibility(e.target.value as Privilege['visibility'])}><option value="editable">Editable</option><option value="read_only">Read-only</option><option value="hidden">Hidden</option></select>
    </FormField>
   </div>
   {draft.type==='integer'&&<>
    <div className="form-grid">
     <FormField label="Minimum" hint="Any whole number, including negative. Empty means 0.">
      <input type="number" step={1} value={draft.minimum??''} placeholder="0" onChange={e=>setDraft({...draft,minimum:e.target.value===''?undefined:Number(e.target.value)})}/>
     </FormField>
     <FormField label="Maximum" optional>
      <input type="number" min={draft.minimum} step={1} value={draft.maximum??''} onChange={e=>setDraft({...draft,maximum:e.target.value===''?undefined:Number(e.target.value)})}/>
     </FormField>
    </div>
    <Check label="Allow unlimited" hint="Tiers can grant no cap at all." checked={draft.unlimited??false} onChange={e=>setDraft({...draft,unlimited:e.target.checked,...(!e.target.checked&&typeof draft.default==='object'?{default:draft.minimum??0}:{})})}/>
   </>}
   {draft.type==='enum'&&<ChoiceList label="Choices" hint="The values your application can receive. Press Enter to add the next one." choices={draft.enum} disabled={busy} onChange={choices=>{const valid=cleanChoices(choices);setDraft({...draft,enum:choices,...(Object.hasOwn(draft,'default')&&!valid.includes(draft.default??'')?{default:valid[0]??''}:{})});}}/>}
   {draft.type==='boolean'&&(envEditable||draft.envOverride)&&<FormField label="Environment prerequisite" optional hint="The Privilege is on only when this environment variable is also true. Only platform administrators can change it.">
    <input className="mono" disabled={!envEditable} value={draft.envOverride??''} pattern="[A-Z][A-Z0-9_]*" onChange={e=>setDraft({...draft,envOverride:e.target.value||undefined})}/>
   </FormField>}
   <Check data-require-value label="Require a value in every Tier variant" hint={<>{needsDefault?`${draft.visibility==='read_only'?'Read-only':'Hidden'} Privileges always use their Catalog default.`:'With no catalog default, each Tier variant must set its own value.'}{defaultError&&<span role="alert" className="field-error">{defaultError}</span>}</>} disabled={needsDefault&&!requireValue||draft.type==='boolean'&&Boolean(draft.envOverride)} checked={requireValue} onChange={e=>setRequired(e.target.checked)}/>
   {asksVariants&&<div className="field variant-values">
    <span className="field-label">Value in existing variants</span>
    <small className="field-hint">{missing.length===1?`${missing[0]!.name} needs a value.`:`${missing.length} variants need a value. One value applies to every variant unless you set each one.`}</small>
    {perVariant?missing.map(v=><div className="field" key={v.id}><span className="field-label">{v.name}</span><Field def={storedDefinition(saved) as unknown as StoredPrivilege} label={`Value for ${v.name}`} value={perVariant[v.id]} onChange={value=>setPerVariant({...perVariant,[v.id]:value})}/></div>)
     :<Field def={storedDefinition(saved) as unknown as StoredPrivilege} label="Value for every variant" value={shared} onChange={setShared}/>}
    {missing.length>1&&<Check label="Set per variant" checked={Boolean(perVariant)} onChange={e=>setPerVariant(e.target.checked?Object.fromEntries(missing.map(v=>[v.id,shared])):undefined)}/>}
   </div>}
   {!requireValue&&<div className="field">
    <span className="field-label">Catalog default</span>
    {/* Read-only locks this value in tiers, Organizations and users, never here: it is the value everyone gets. */}
    <fieldset className="bare" disabled={Boolean(binding)}>
     <Field def={storedDefinition(saved) as unknown as StoredPrivilege} value={saved.default} onChange={value=>setDraft({...draft,default:value} as Privilege)}/>
    </fieldset>
   </div>}
  </fieldset>

  <fieldset className="form-section">
   <legend>Organize <span className="optional">Optional</span></legend>
   <p className="section-hint">Helps people find this Privilege in the console. It does not change how it evaluates.</p>
   <GroupPicker groups={groups} takenIds={takenGroupIds??[]} selected={draft.groupId} disabled={busy} onChange={groupId=>setDraft({...draft,groupId})} onCreate={onCreateGroup}/>
   <TagPicker tags={tags} selected={draft.tags} disabled={busy} onChange={tags=>setDraft({...draft,tags})} onCreate={onCreateTag}/>
  </fieldset>

  <div className="form-actions">
   <button type="button" className="btn" disabled={busy} onClick={onCancel}>Cancel</button>
   <button className="btn primary" disabled={busy}>{editing?'Save changes':'Save privilege'}</button>
  </div>
 </form>;
}
