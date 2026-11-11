import {useId,useRef,useState,type ReactNode} from 'react';
import {identifierFromTitle} from './identifier.ts';
import type {Group} from '../../../server/workspace/model.ts';

const Folder=()=><svg className="folder-icon" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M1.5 3.5a1 1 0 0 1 1-1h3.6l1.5 1.6h5.9a1 1 0 0 1 1 1v7.4a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1z" fill="currentColor"/></svg>;

/**
 * Choose the one Group a Privilege belongs to, like choosing a folder in Finder:
 * Groups show as a folder tree, and any folder can get a new Group inside it, named in place.
 */
export function GroupPicker({label='Group',noneLabel='No group',groups:saved,exclude,takenIds,selected,onChange,onCreate,disabled=false}:{
 label?:string;noneLabel?:string;
 /** A Group and its descendants that cannot be chosen, such as the Group being moved. */
 exclude?:string;
 groups:Group[];
 /** Every existing Group identifier, including ones not shown, so a new ID never collides. */
 takenIds:readonly string[];
 selected?:string;onChange:(id:string|undefined)=>void;
 /** Omit to choose only; with it, every folder can get a new Group inside it. */
 onCreate?:(group:Group)=>Promise<boolean>;disabled?:boolean;
}){
 const id=useId(),menu=useRef<HTMLDetailsElement>(null),pending=useRef(false);
 const [draft,setDraft]=useState<{parentId?:string;name:string}>(),[creating,setCreating]=useState(false),[error,setError]=useState('');
 const [created,setCreated]=useState<Group[]>([]);
 // Show a Group created here right away, before the saved list refreshes.
 const all=[...saved,...created.filter(c=>!saved.some(g=>g.id===c.id))];
 const blocked=new Set<string>();
 if(exclude){blocked.add(exclude);for(let grew=true;grew;){grew=false;for(const g of all)if(g.parentId&&blocked.has(g.parentId)&&!blocked.has(g.id)){blocked.add(g.id);grew=true;}}}
 const groups=all.filter(g=>!blocked.has(g.id));
 const byId=new Map(groups.map(g=>[g.id,g]));
 const unavailable=disabled||creating;

 function path(groupId?:string):string[]{
  const names:string[]=[],seen=new Set<string>();
  for(let g=groupId?byId.get(groupId):undefined;g&&!seen.has(g.id);g=g.parentId?byId.get(g.parentId):undefined){seen.add(g.id);names.unshift(g.name);}
  return names;
 }
 /** Children of a folder; a Group whose parent is not shown is listed at the top level. */
 const children=(parentId?:string)=>groups.filter(g=>parentId?g.parentId===parentId:!g.parentId||!byId.has(g.parentId));
 function close(){if(menu.current)menu.current.open=false;setDraft(undefined);setError('');menu.current?.querySelector('summary')?.focus();}
 function choose(groupId?:string){onChange(groupId);close();}
 function startNew(parentId?:string){setDraft({parentId,name:''});setError('');}
 async function create(){
  const name=draft?.name.trim();
  if(!draft||!name||!onCreate||unavailable||pending.current)return;
  const taken=new Set([...takenIds,...groups.map(g=>g.id)]),base=identifierFromTitle(name,'group')||'group';
  // Identifiers are at most 80 characters, so a collision suffix replaces the end of the base.
  let groupId=base,suffix=1;while(taken.has(groupId)){const tail=`_${suffix++}`;groupId=base.slice(0,80-tail.length).replace(/_+$/,'')+tail;}
  pending.current=true;setCreating(true);setError('');
  const group:Group={id:groupId,name,description:'',...(draft.parentId?{parentId:draft.parentId}:{})};
  try{if(await onCreate(group)){setCreated(c=>[...c,group]);choose(groupId);}}
  catch(e){setError(e instanceof Error?e.message:'Could not create the group');}
  finally{pending.current=false;setCreating(false);}
 }
 function newRow(parentId?:string){
  if(!draft||draft.parentId!==parentId)return null;
  const parent=parentId?byId.get(parentId)?.name:undefined;
  return <li className="group-new">
   <Folder/>
   <input autoFocus maxLength={200} disabled={unavailable} aria-label={parent?`Name of the new group inside ${parent}`:'Name of the new group'} value={draft.name}
    onChange={e=>{setDraft({...draft,name:e.target.value});setError('');}}
    onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();void create();}else if(e.key==='Escape'){e.preventDefault();e.stopPropagation();setDraft(undefined);}}}/>
   <button type="button" className="btn" disabled={unavailable||!draft.name.trim()} onClick={()=>void create()}>{creating?'Creating…':'Create'}</button>
  </li>;
 }
 function branch(parentId?:string):ReactNode{
  return <>{children(parentId).map(g=><li key={g.id}>
   <div className="group-row">
    <button type="button" className="group-option" aria-current={selected===g.id?'true':undefined} disabled={unavailable} onClick={()=>choose(g.id)}><Folder/><span>{g.name}</span></button>
    {onCreate&&<button type="button" className="icon-btn" disabled={unavailable} aria-label={`New group inside ${g.name}`} title={`New group inside ${g.name}`} onClick={()=>startNew(g.id)}>+</button>}
   </div>
   {(children(g.id).length>0||draft?.parentId===g.id)&&<ul>{branch(g.id)}{newRow(g.id)}</ul>}
  </li>)}</>;
 }

 const current=path(selected);
 return <div className="field group-field">
  <span className="field-label" id={`${id}-label`}>{label}</span>
  <details ref={menu} className="group-picker" onToggle={e=>{if(!(e.currentTarget as HTMLDetailsElement).open){setDraft(undefined);setError('');}}}
   onKeyDown={e=>{if(e.key==='Escape'&&menu.current?.open){e.preventDefault();close();}}}>
   <summary aria-labelledby={`${id}-label ${id}-value`}><Folder/><span id={`${id}-value`}>{current.length?current.join(' › '):noneLabel}</span></summary>
   <div className="group-popover">
    <ul className="group-tree">
     <li><div className="group-row"><button type="button" className="group-option" aria-current={!selected?'true':undefined} disabled={unavailable} onClick={()=>choose(undefined)}><span className="folder-icon" aria-hidden="true"/><span>{noneLabel}</span></button></div></li>
     {branch(undefined)}
     {newRow(undefined)}
    </ul>
    {error&&<p className="field-error" role="alert">{error}</p>}
    {onCreate&&<button type="button" className="btn-link" disabled={unavailable||draft?.parentId===undefined&&draft!==undefined} onClick={()=>startNew(undefined)}>+ New group</button>}
   </div>
  </details>
 </div>;
}
