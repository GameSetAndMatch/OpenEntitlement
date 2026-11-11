import { useState } from "react";
import type { Workspace,Save } from "./app.tsx";
import { Group,Row } from "./settings-group.tsx";

/** What an Organization gets once its tier's grace runs out, or its contract ends. Lives beside the tiers that define grace. */
export function StatusPolicy({workspace:w,save,busy}:{workspace:Workspace;save:Save;busy:boolean}){
  const [policy,setPolicy]=useState(w.data.statusPolicy);
  const changed=JSON.stringify(policy)!==JSON.stringify(w.data.statusPolicy);
  const value=(status:"past_due"|"ended")=>policy[status].action==="readOnly"?"readOnly":`fallback:${(policy[status] as {variantId:string}).variantId}`;
  return <Group title="When a contract lapses" description="What an Organization keeps after its tier's grace period, or once its contract ends. Read-only keeps its values and tells your application to stop changes.">
    <form onSubmit={e=>{e.preventDefault();void save("policy",policy,"Update contract-status policy");}}>
      {(["past_due","ended"] as const).map(status=><Row key={status} label={status==="past_due"?"Past due, after grace":"Contract ended"}><select className="fit" value={value(status)} onChange={e=>setPolicy({...policy,[status]:e.target.value==="readOnly"?{action:"readOnly"}:{action:"fallback",variantId:e.target.value.slice(9)}})}><option value="readOnly">Read-only</option>{w.data.variants.map(v=><option key={v.id} value={`fallback:${v.id}`}>Fallback to {v.name}</option>)}</select></Row>)}
      {changed&&<div className="settings-row settings-save"><button type="button" className="btn" onClick={()=>setPolicy(w.data.statusPolicy)}>Cancel</button><button className="btn primary" disabled={busy}>Save</button></div>}
    </form>
  </Group>;
}
