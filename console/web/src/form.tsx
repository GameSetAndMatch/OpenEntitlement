import {cloneElement,useId,type InputHTMLAttributes,type ReactElement,type ReactNode} from 'react';

/**
 * One labelled control. The label holds only the field's name, so the accessible
 * name stays short; the hint is announced as its description. See web/UI-GUIDELINES.md.
 */
export function FormField({label,hint,optional=false,children}:{label:string;hint?:ReactNode;optional?:boolean;children:ReactElement<{id?:string;'aria-describedby'?:string}>}){
 const id=useId(),hintId=`${id}-hint`;
 return <div className="field">
  <div className="field-label-row"><label className="field-label" htmlFor={id}>{label}</label>{optional&&<span className="optional">Optional</span>}</div>
  {cloneElement(children,{id,'aria-describedby':hint?hintId:undefined})}
  {hint&&<small className="field-hint" id={hintId}>{hint}</small>}
 </div>;
}

/** A checkbox with its label beside it and an optional description underneath. */
export function Check({label,hint,...input}:{label:string;hint?:ReactNode}&Omit<InputHTMLAttributes<HTMLInputElement>,'type'|'id'>){
 const id=useId(),hintId=`${id}-hint`;
 return <div className="check">
  <input type="checkbox" id={id} aria-describedby={hint?hintId:undefined} {...input}/>
  <div><label htmlFor={id}>{label}</label>{hint&&<small className="field-hint" id={hintId}>{hint}</small>}</div>
 </div>;
}
