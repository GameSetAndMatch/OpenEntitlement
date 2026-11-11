import { cloneElement,useId,type ReactElement,type ReactNode } from "react";

/** One settings section: a heading, an optional sentence of purpose, then its rows. */
export function Group({title,description,children}:{title:string;description?:string;children:ReactNode}){
  const id=useId();
  return <section className="settings-group" aria-labelledby={id}><h2 id={id}>{title}</h2>{description&&<p className="settings-purpose">{description}</p>}<div className="settings-rows">{children}</div></section>;
}
/** A row with a control: the name and one line of explanation on the left, the control on the right. */
export function Row({label,description,children}:{label:string;description?:string;children:ReactElement<{id?:string;"aria-describedby"?:string}>|[ReactElement<{id?:string;"aria-describedby"?:string}>,...ReactNode[]]}){
  const id=useId(),hint=`${id}-hint`;
  const [control,...rest]=Array.isArray(children)?children:[children];
  return <div className="settings-row"><div className="settings-text"><label htmlFor={id}>{label}</label>{description&&<small id={hint}>{description}</small>}</div><div className="settings-controls">{cloneElement(control,{id,"aria-describedby":description?hint:undefined})}{rest}</div></div>;
}
/** A row that shows a value: the name on the left, the value and its one action on the right. */
export function Item({label,description,children}:{label:ReactNode;description?:ReactNode;children?:ReactNode}){
  return <div className="settings-row"><div className="settings-text"><span className="settings-name">{label}</span>{description&&<small>{description}</small>}</div>{children&&<div className="settings-controls">{children}</div>}</div>;
}
/** A full-width value with a hint, for a one-time link or secret. */
export function Field({label,hint,children}:{label:string;hint:string;children:ReactElement<{id?:string;"aria-describedby"?:string}>}){
  const id=useId();
  return <div className="settings-row settings-reveal"><label htmlFor={id}>{label}</label>{cloneElement(children,{id,"aria-describedby":`${id}-hint`})}<small id={`${id}-hint`}>{hint}</small></div>;
}
