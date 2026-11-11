import {useEffect,useId,useRef,useState} from 'react';

/** Problems with a list of string choices, as shown next to the offending row. */
export function choiceErrors(choices:readonly string[]):(string|undefined)[]{
 const seen=new Set<string>();
 return choices.map(raw=>{
  const choice=raw.trim();
  if(!choice)return choices.length===1?'Add at least one choice':undefined;
  if(seen.has(choice))return 'This choice is already in the list';
  seen.add(choice);
  return undefined;
 });
}

/** The saved form of a choice list: trimmed, without blank rows. */
export function cleanChoices(choices:readonly string[]):string[]{return choices.map(c=>c.trim()).filter(Boolean);}

/**
 * An ordered list of string choices, edited one row at a time.
 * Enter adds a row below, Backspace in an empty row removes it, and pasting
 * several lines adds one row per line. Blank rows are dropped on save.
 */
export function ChoiceList({label,hint,choices,onChange,disabled=false,maxLength=200,maxChoices=100}:{label:string;hint?:string;choices:readonly string[];onChange:(choices:string[])=>void;disabled?:boolean;maxLength?:number;maxChoices?:number}){
 const id=useId(),inputs=useRef<(HTMLInputElement|null)[]>([]),[focus,setFocus]=useState<number>();
 const rows=choices.length?choices:[''];
 const errors=choiceErrors(rows);
 const full=rows.length>=maxChoices;
 useEffect(()=>{if(focus!==undefined){inputs.current[focus]?.focus();setFocus(undefined);}},[focus]);
 useEffect(()=>{inputs.current.forEach((input,i)=>input?.setCustomValidity(errors[i]??''));});
 function insert(at:number,values:string[]=['']){const next=[...rows];next.splice(at,0,...values);onChange(next.slice(0,maxChoices));setFocus(Math.min(at+values.length-1,maxChoices-1));}
 function remove(at:number){if(rows.length===1){onChange(['']);setFocus(0);return;}onChange(rows.filter((_,i)=>i!==at));setFocus(Math.max(0,at-1));}
 function update(at:number,value:string){onChange(rows.map((c,i)=>i===at?value:c));}
 return <div className="choice-list" role="group" aria-labelledby={`${id}-label`} aria-describedby={hint?`${id}-hint`:undefined}>
  <span className="field-label" id={`${id}-label`}>{label}</span>
  {hint&&<small className="field-hint" id={`${id}-hint`}>{hint}</small>}
  <ol>
   {rows.map((choice,i)=><li key={i}>
    <span className="choice-index" aria-hidden="true">{i+1}</span>
    <input ref={el=>{inputs.current[i]=el;}} aria-label={`Choice ${i+1}`} value={choice} maxLength={maxLength} disabled={disabled} required={i===0} aria-invalid={Boolean(errors[i])} aria-describedby={errors[i]?`${id}-error-${i}`:undefined} placeholder={i===0?'e.g. standard':'Another choice'}
     onChange={e=>update(i,e.target.value)}
     onKeyDown={e=>{
      if(e.key==='Enter'){e.preventDefault();if(!full)insert(i+1);}
      else if(e.key==='Backspace'&&choice===''&&rows.length>1){e.preventDefault();remove(i);}
      else if(e.key==='ArrowDown'&&i<rows.length-1){e.preventDefault();inputs.current[i+1]?.focus();}
      else if(e.key==='ArrowUp'&&i>0){e.preventDefault();inputs.current[i-1]?.focus();}
     }}
     onPaste={e=>{const lines=e.clipboardData.getData('text').split(/\r?\n/).map(l=>l.trim()).filter(Boolean);if(lines.length<2)return;e.preventDefault();const at=choice.trim()?i+1:i,next=[...rows];next.splice(at,choice.trim()?0:1,...lines);onChange(next.slice(0,maxChoices));setFocus(Math.min(at+lines.length-1,maxChoices-1));}}/>
    <button type="button" className="icon-btn" disabled={disabled||(rows.length===1&&!choice)} aria-label={`Remove choice ${i+1}`} onClick={()=>remove(i)}>×</button>
    {errors[i]&&<small className="field-error" id={`${id}-error-${i}`} role="alert">{errors[i]}</small>}
   </li>)}
  </ol>
  <button type="button" className="btn-link" disabled={disabled||full} onClick={()=>insert(rows.length)}>+ Add choice</button>
 </div>;
}
