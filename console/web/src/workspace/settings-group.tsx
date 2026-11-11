import { cloneElement,useId,type ReactElement,type ReactNode } from "react";

/** One settings section: its title and purpose beside (or above) a grouped list of rows. */
export function Group({title,description,children}:{title:string;description:string;children:ReactNode}){
  const id=useId();
  return <section className="settings-group" aria-labelledby={id}><header><h2 id={id}>{title}</h2><p>{description}</p></header><div className="settings-card">{children}</div></section>;
}
/** A labeled control on one row: the label on the left, the control on the right. */
export function Row({label,children}:{label:string;children:ReactElement<{id?:string}>}){
  const id=useId();
  return <div className="settings-row"><label className="settings-label" htmlFor={id}>{label}</label>{cloneElement(children,{id})}</div>;
}
/** A full-width labeled value with a hint, for links and secrets. */
export function Field({label,hint,children}:{label:string;hint:string;children:ReactElement<{id?:string;"aria-describedby"?:string}>}){
  const id=useId();
  return <div className="settings-field"><label className="settings-label" htmlFor={id}>{label}</label>{cloneElement(children,{id,"aria-describedby":`${id}-hint`})}<small id={`${id}-hint`}>{hint}</small></div>;
}
