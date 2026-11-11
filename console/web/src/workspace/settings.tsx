import { useEffect,useRef,useState } from "react";
import { Field,Group,Row } from "./settings-group.tsx";
import {catalogDefinition} from "../../../server/workspace/catalog-adapter.ts";
import { stringify } from "yaml";
import { request } from "./client.ts";
import type { Workspace,Save } from "./app.tsx";
import { useReason,useToast } from "../ui.tsx";
import { FormField } from "../form.tsx";
export function WorkspaceSettings({workspace:w,save,account,busy,refreshAccess}:{workspace:Workspace;save:Save;account:{id:string;email:string;platformAdmin:boolean};busy:boolean;refreshAccess:()=>Promise<void>}){
  const [members,setMembers]=useState<any[]>([]),[keys,setKeys]=useState<any[]>([]),[email,setEmail]=useState(""),[role,setRole]=useState("User"),[link,setLink]=useState(""),[secret,setSecret]=useState(""),[name,setName]=useState(""),[error,setError]=useState("");
  const [pending,setPending]=useState(false);const pendingRef=useRef(false);
  const locked=busy||pending;
  const [hostedTier,setHostedTier]=useState(w.hosting?.tier??"pro");
  const ask=useReason(),toast=useToast();
  const owner=w.role==="Owner"||w.role==="Platform administrator",manager=owner||w.role==="Manager";
  const base=`/api/workspaces/${w.id}`;
  // Every load takes a generation number; only the newest one may update the lists.
  const generation=useRef(0);
  async function load(){const mine=++generation.current;const m=manager?await request(base+"/members"):[];const k=owner?await request(base+"/keys"):[];if(mine===generation.current){setMembers(m);setKeys(k);}}
  async function reload(){await load();}
  useEffect(()=>{let active=true;const refresh=async()=>{try{await load();}catch(e){if(active)setError((e as Error).message);}};void refresh();
    // Stay current without a refresh button: reload when the person comes back to this window.
    const onFocus=()=>{if(document.visibilityState==="visible")void refresh();};window.addEventListener("focus",onFocus);document.addEventListener("visibilitychange",onFocus);
    return()=>{active=false;generation.current++;window.removeEventListener("focus",onFocus);document.removeEventListener("visibilitychange",onFocus);};
  },[base,manager,owner]); // load reads exactly base, manager and owner
  async function mutate(label:string,action:(reason:string)=>Promise<void|"access-changed">){if(pendingRef.current||busy)return;pendingRef.current=true;setPending(true);try{const reason=await ask(label);if(!reason)return;setError("");const result=await action(reason);if(result!=="access-changed")await reload();toast("Changes saved");}catch(e){setError((e as Error).message);}finally{pendingRef.current=false;setPending(false);}}
  const tierChanged=hostedTier!==(w.hosting?.tier??"pro");
  return <div className="settings">{error&&<p role="alert" className="notice error">{error}</p>}
    <Group title="Members" description={account.platformAdmin?"As a Platform administrator, you can manage every workspace.":`Your role: ${w.role}.`}>
      {manager&&<>{members.map(m=><div className="settings-row" key={m.id}>
        <span className="member"><span className="member-mark" aria-hidden="true">{m.email.slice(0,1).toUpperCase()}</span><span className="member-email">{m.email}{m.id===account.id&&<small>You</small>}</span></span>
        <span className="settings-controls">{owner?<select className="fit" disabled={locked} aria-label={`Role for ${m.email}`} value={m.role} onChange={e=>{const nextRole=e.target.value;void mutate("Change member role",async reason=>{await request(base+"/members","PUT",{accountId:m.id,role:nextRole,reason});if(m.id===account.id&&!account.platformAdmin){await refreshAccess();return "access-changed";}});}}>{["Owner","Manager","User"].map(r=><option key={r}>{r}</option>)}</select>:<span className="settings-value">{m.role}</span>}
        {(owner||m.role!=="Owner")&&<button className="btn-quiet danger" disabled={locked} aria-label={`Remove ${m.email}`} onClick={()=>void mutate("Remove workspace member",async reason=>{await request(base+"/members","PUT",{accountId:m.id,role:null,reason});if(m.id===account.id){await refreshAccess();return "access-changed";}})}>Remove</button>}</span>
      </div>)}
      <form className="settings-row settings-add" aria-label="Invite a member" onSubmit={e=>{e.preventDefault();void mutate("Invite workspace member",async reason=>{const result=await request(base+"/invitations","POST",{email,role,reason});setLink(location.origin+"/app/#invite="+result.token);setEmail("");});}}>
        <FormField label="Email address"><input type="email" required value={email} onChange={e=>setEmail(e.target.value)}/></FormField>
        <FormField label="Role"><select className="fit" value={role} onChange={e=>setRole(e.target.value)}>{(owner?["User","Manager","Owner"]:["User","Manager"]).map(r=><option key={r}>{r}</option>)}</select></FormField>
        <button className="btn" disabled={locked}>Create invitation link</button>
      </form>
      {link&&<div className="settings-row settings-stack"><Field label="Invitation link (expires in 7 days)" hint="Share it with the invited person. They must sign in with that verified email address."><input readOnly value={link} onFocus={e=>e.target.select()}/></Field></div>}</>}
    </Group>
    {owner&&<Group title="Application API keys" description="Your application uses these keys to evaluate entitlements in this workspace. A secret is shown only once.">
      <div className="settings-row"><span className="settings-label">Workspace ID</span><code className="settings-value">{w.id}</code></div>
      {keys.map(k=><div className="settings-row" key={k.id}><span className="settings-label">{k.name}<small><code>{k.prefix}…</code> · {k.revoked?"Revoked":k.scope}</small></span>{!k.revoked&&<button className="btn-quiet danger" disabled={locked} aria-label={`Revoke ${k.name}`} onClick={()=>void mutate("Revoke API key",async reason=>{await request(base+"/keys/"+k.id,"DELETE",{reason});})}>Revoke</button>}</div>)}
      <form className="settings-row settings-add" aria-label="Create an evaluation key" onSubmit={e=>{e.preventDefault();void mutate("Create evaluation key",async reason=>{const result=await request(base+"/keys","POST",{name,scope:"evaluate",reason});setSecret(result.secret);setName("");});}}>
        <FormField label="Key name"><input required value={name} onChange={e=>setName(e.target.value)}/></FormField>
        <button className="btn" disabled={locked}>Create evaluation key</button>
      </form>
      {secret&&<div className="settings-row settings-stack"><Field label="Save this secret securely" hint="It will not be shown again."><input readOnly type="password" value={secret} onFocus={e=>e.target.select()}/></Field><button className="btn" onClick={()=>void navigator.clipboard.writeText(secret).then(()=>toast("API key copied")).catch(()=>setError("Copy failed. Select and copy the secret manually."))}>Copy key</button></div>}
    </Group>}
    <Group title="Plan" description="Your OpenEntitlement plan decides what this workspace can evaluate. It is separate from the tiers you sell to your customers.">
      {account.platformAdmin&&w.hosting?.mode==="saas"?<form onSubmit={e=>{e.preventDefault();void save("hosting",{tier:hostedTier},"Change Cloud service tier");}}>
        <Row label="Cloud service tier"><select className="fit" value={hostedTier} onChange={e=>setHostedTier(e.target.value as "pro"|"enterprise")}><option value="pro">Pro — Organizations</option><option value="enterprise">Enterprise — Organizations and users</option></select></Row>
        {tierChanged&&<div className="settings-row settings-save"><button type="button" className="btn" onClick={()=>setHostedTier(w.hosting?.tier??"pro")}>Cancel</button><button className="btn primary" disabled={locked}>Save Cloud service tier</button></div>}
      </form>:<div className="settings-row"><span className="settings-label">{w.hosting?.mode==="saas"?`Cloud ${w.hosting.tier==="enterprise"?"Enterprise":"Pro"}`:"Self-hosted"}</span><span className="settings-value">{w.hosting?.subjectEntitlements?"Organizations and their users":"Organizations"}</span></div>}
    </Group>
  </div>;
}
export function WorkspaceConfiguration({workspace:w}:{workspace:Workspace}){
  const hidden=new Set(w.data.privileges.filter(p=>p.hidden||w.data.features.find(f=>f.id===p.featureId)?.hidden).map(p=>p.key));
  const visibleValues=(values:Record<string,unknown>)=>Object.fromEntries(Object.entries(values).filter(([key])=>!hidden.has(key)));
  const yaml=stringify({format:"openentitlement-workspace-snapshot",formatVersion:1,workspace:{id:w.id,name:w.name},...w.data,hostedTier:undefined,subjects:w.data.subjects.map(s=>({...s,terms:visibleValues(s.terms),grants:visibleValues(s.grants)})),features:undefined,groups:w.data.groups.map(({legacyFeatureId:_legacy,...g})=>({id:g.id,title:g.name,description:g.description,...(g.parentId?{parentId:g.parentId}:{})})),tags:w.data.tags.map(t=>({id:t.id,title:t.name,description:t.description})),privileges:w.data.privileges.filter(p=>!hidden.has(p.key)).map(p=>catalogDefinition(p,w.data)),variants:w.data.variants.map(v=>({...v,values:visibleValues(v.values)})),organizations:w.data.organizations.map(o=>({...o,terms:visibleValues(o.terms)}))});
  function download(){const url=URL.createObjectURL(new Blob([yaml],{type:"application/yaml"})),a=document.createElement("a");a.href=url;a.download="workspace.yaml";a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  return <section className="panel configuration-panel"><div className="section-title"><h2>Workspace YAML</h2><button className="btn" onClick={download}>Download YAML</button></div><p>Includes the catalog, tiers and variants, Organization terms, and user terms and grants. Excludes hidden privileges, environment values, members and API keys.</p><pre className="configuration-code" tabIndex={0} aria-label="Workspace YAML"><code>{yaml}</code></pre></section>;
}
