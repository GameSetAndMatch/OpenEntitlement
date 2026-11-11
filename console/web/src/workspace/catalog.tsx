import {useState} from 'react';
import {EnvironmentNotice} from '../privilege-controls.tsx';
import {PrivilegeForm,freshPrivilege} from './privilege-form.tsx';
import {FormField} from '../form.tsx';
import {GroupPicker} from './group-picker.tsx';
import {catalogDefinition} from '../../../server/workspace/catalog-adapter.ts';
import type {Privilege} from '../../../server/workspace/privilege-definition.ts';
import type {Group} from '../../../server/workspace/model.ts';
import type {Workspace,Save} from './app.tsx';
export function Catalog({workspace:w,save,canEdit,busy}:{workspace:Workspace;save:Save;canEdit:boolean;busy:boolean}){
 const [draft,setDraft]=useState<Privilege>(freshPrivilege),[editing,setEditing]=useState(false),[show,setShow]=useState(false);
 const [container,setContainer]=useState<'groups'>(),[meta,setMeta]=useState<Group>({id:'',name:'',description:''}),[tagFilter,setTagFilter]=useState('');
 const definitions=w.data.privileges.map(p=>catalogDefinition(p,w.data));
 const groups=w.data.groups.filter(g=>!w.data.features.find(f=>f.id===g.legacyFeatureId)?.hidden);
 const visible=definitions.filter(p=>p.visibility!=='hidden'&&(!tagFilter||p.tags.includes(tagFilter)));
 const envEditable=w.role==='Platform administrator';
 function begin(p?:Privilege){setContainer(undefined);setDraft(p?structuredClone(p):freshPrivilege());setEditing(Boolean(p));setShow(true);}
 function metadata(row:Group){setShow(false);setContainer('groups');setMeta({id:row.id,name:row.name,description:row.description,...(row.parentId?{parentId:row.parentId}:{})});}
 function row(p:Privilege){const binding=w.environment?.[p.key],value=binding?p.default===true&&binding.value:p.default;return <div className={`catalog-feature ${p.visibility==='read_only'||binding?'environment-frozen':''}`} key={p.key}><div><strong>{p.title}</strong><code>{p.key}</code><p>{p.description}</p><div className="row">{p.tags.map(id=><span className="badge" key={id}>{w.data.tags.find(t=>t.id===id)?.name??id}</span>)}</div><EnvironmentNotice binding={binding} frozen={p.visibility==='read_only'}/></div><div><small>{p.type==='enum'?'String enum':p.type}</small><strong>{value===undefined?'Required in every variant':typeof value==='object'?'∞':typeof value==='boolean'?(value?'Enabled':'Disabled'):String(value)}</strong><small>{binding?'Environment prerequisite':p.visibility==='read_only'?'Read-only default':'Catalog default'}</small></div>{canEdit&&<button className="btn" onClick={()=>begin(p)}>Edit {p.title}</button>}</div>;}
 function groupRows(g:Group):React.ReactNode{return <section className="catalog-group" key={g.id}><div className="section-title"><div><h2>{g.name}</h2><p>{g.description}</p></div>{canEdit&&<button className="btn" onClick={()=>metadata(g)}>Edit group</button>}</div>{visible.filter(p=>p.groupId===g.id).map(row)}{groups.filter(child=>child.parentId===g.id).map(groupRows)}</section>;}
 return <>
  {canEdit&&definitions.length>0&&!show&&!container&&<div className="workspace-actions"><button className="btn primary" onClick={()=>begin()}>Define privilege</button></div>}
  {w.data.tags.length>0&&!show&&!container&&<section className="panel workspace-form"><label>Filter by tag<select value={tagFilter} onChange={e=>setTagFilter(e.target.value)}><option value="">All tags</option>{w.data.tags.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</select></label></section>}
  {container&&canEdit&&<form className="panel form" onSubmit={e=>{e.preventDefault();void save('groups',meta,'Update Group').then(ok=>{if(ok)setContainer(undefined);});}}>
   <div className="form-header"><h2>Edit {meta.name}</h2><p>Groups organize Privileges in the console. They never change evaluation keys.</p></div>
   <fieldset className="form-section"><legend>Group</legend>
    <div className="form-grid"><FormField label="Title"><input required value={meta.name} onChange={e=>setMeta({...meta,name:e.target.value})}/></FormField></div>
    <FormField label="Description" optional><textarea rows={2} value={meta.description} onChange={e=>setMeta({...meta,description:e.target.value})}/></FormField>
    <GroupPicker label="Inside" noneLabel="Top level" groups={groups} exclude={meta.id} takenIds={w.data.groups.map(g=>g.id)} selected={meta.parentId} disabled={busy} onChange={parentId=>setMeta({...meta,parentId})}/>
   </fieldset>
   <div className="form-actions"><button className="btn" type="button" onClick={()=>setContainer(undefined)}>Cancel</button><button className="btn primary" disabled={busy}>Save group</button></div>
  </form>}
  {show&&canEdit&&<PrivilegeForm key={draft.key+String(editing)} initial={draft} editing={editing} groups={groups} tags={w.data.tags} environment={w.environment} envEditable={envEditable} busy={busy}
   onSave={p=>save('catalog',p,editing?'Update Privilege':'Define Privilege').then(ok=>{if(ok)setShow(false);return ok;})} onCreateTag={tag=>save('tags',tag,'Add tag')} takenGroupIds={w.data.groups.map(g=>g.id)} onCreateGroup={group=>save('groups',group,'Create Group')} onCancel={()=>setShow(false)}/>}
  {!visible.length&&!show&&!container&&(definitions.length?<section className="panel empty-workspace"><h2>No privileges match</h2><p>Choose another tag, or all tags.</p></section>:<section className="panel empty-workspace"><h2>Define your first privilege</h2><p>A privilege is one thing your product allows or limits, such as a feature or a seat limit.</p>{canEdit&&<button className="btn primary" onClick={()=>begin()}>Define privilege</button>}</section>)}
  {!show&&!container&&<>{groups.filter(g=>!g.parentId).map(groupRows)}{visible.filter(p=>!p.groupId).map(row)}</>}
 </>;
}
