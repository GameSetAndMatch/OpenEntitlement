import {useRef,useState} from 'react';
import type {Tag} from '../../../server/workspace/model.ts';

/** Tags are reusable labels selected in the Privilege editor, separate from Groups. */
export function TagPicker({tags,selected,onChange,onCreate,disabled=false}:{tags:Tag[];selected:string[];onChange:(ids:string[])=>void;onCreate:(tag:Tag)=>Promise<boolean>;disabled?:boolean}){
 const [query,setQuery]=useState(''),[creating,setCreating]=useState(false),[error,setError]=useState('');
 const pending=useRef(false),menu=useRef<HTMLDetailsElement>(null);
 const text=query.trim(),exact=tags.find(t=>t.name.toLocaleLowerCase()===text.toLocaleLowerCase());
 const matches=tags.filter(t=>t.name.toLocaleLowerCase().includes(text.toLocaleLowerCase()));
 const unavailable=disabled||creating;
 function toggle(id:string){onChange(selected.includes(id)?selected.filter(key=>key!==id):[...selected,id]);}
 async function add(){
  if(unavailable||pending.current||!text)return;
  if(exact){if(!selected.includes(exact.id))onChange([...selected,exact.id]);setQuery('');return;}
  pending.current=true;setCreating(true);setError('');
  const stem=(text.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_+|_+$/g,'')||'tag').slice(0,60);
  const base=/^[a-z]/.test(stem)?stem:`tag_${stem}`;let id=base,suffix=1;
  while(tags.some(t=>t.id===id))id=`${base}_${suffix++}`;
  try{if(await onCreate({id,name:text,description:''})){onChange([...selected,id]);setQuery('');}}
  catch(e){setError(e instanceof Error?e.message:'Could not add the tag');}
  finally{pending.current=false;setCreating(false);}
 }
 return <div className="privilege-tags"><span className="tag-field-title">Tags</span><div className="selected-tags">{selected.map(id=><button type="button" className="tag-chip" key={id} disabled={unavailable} aria-label={`Remove tag ${tags.find(t=>t.id===id)?.name??id}`} onClick={()=>toggle(id)}>{tags.find(t=>t.id===id)?.name??id}<span aria-hidden="true"> ×</span></button>)}</div>
  <details ref={menu} className="tag-picker" onKeyDown={e=>{if(e.key==='Escape'&&menu.current?.open){e.preventDefault();menu.current.open=false;menu.current.querySelector('summary')?.focus();}}}><summary>Add tags</summary><div className="tag-popover"><label>Find or add a tag<input maxLength={200} value={query} disabled={unavailable} onChange={e=>{setQuery(e.target.value);setError('');}} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();void add();}}} placeholder="Search tags…"/></label><div className="tag-options">{matches.map(t=><label key={t.id}><input type="checkbox" checked={selected.includes(t.id)} disabled={unavailable} onChange={()=>toggle(t.id)}/>{t.name}</label>)}</div>{text&&!exact&&<button className="btn" type="button" disabled={unavailable} onClick={()=>void add()}>{creating?'Adding…':`Add “${text}”`}</button>}{!text&&!tags.length&&<small>Type a name to add your first tag.</small>}{error&&<p role="alert">{error}</p>}</div></details>
 </div>;
}
