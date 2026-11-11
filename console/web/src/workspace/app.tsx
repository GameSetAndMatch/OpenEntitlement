import { useEffect, useRef, useState } from "react";
import { request,setCsrf } from "./client.ts";
import { identify, resetIdentity } from "../telemetry.ts";
import { Catalog } from "./catalog.tsx";
import { Tiers } from "./tiers.tsx";
import { Organizations } from "./organizations.tsx";
import { WorkspaceSettings,WorkspaceConfiguration } from "./settings.tsx";
import type { WorkspaceData } from "../../../server/workspace/model.ts";
import { useReason,useToast } from "../ui.tsx";
import { WorkspaceSwitcher } from "./workspace-switcher.tsx";
import { FormField } from "../form.tsx";
import "./style.css";
export interface Workspace {hosting?:{mode:"self_hosted"|"saas";tier:"pro"|"enterprise";subjectEntitlements:boolean};id:string;name:string;role:string;data:WorkspaceData;revision:number;environment?:import("../../../server/environment.ts").EnvironmentOverrides}
export type Save=(section:string,entry:unknown,title:string,method?:"PUT"|"DELETE")=>Promise<boolean>;
const pages=["Privilege Catalog","Tiers","Organizations","Configuration","Audit","Settings"];
// The last workspace this browser used. A convenience only: the list from the server decides access.
const LAST_WORKSPACE="oe.workspace";
function rememberedWorkspace(){try{return localStorage.getItem(LAST_WORKSPACE)??"";}catch{return "";}}
function remember(id:string){try{if(id)localStorage.setItem(LAST_WORKSPACE,id);}catch{/* storage unavailable */}}
function pick(list:Array<{id:string}>,preferred=rememberedWorkspace()){return list.find(w=>w.id===preferred)?.id??list[0]?.id??"";}
function currentPage(){const hash=location.hash.slice(1);if(hash==="catalog")return "Privilege Catalog";return pages.find(p=>p.toLowerCase()===hash)??"Privilege Catalog";}
export function WorkspaceApp(){
  const [session,setSession]=useState<any>(),[ready,setReady]=useState(false),[error,setError]=useState("");
  const [list,setList]=useState<Array<{id:string;name:string;role:string}>>([]),[selected,setSelected]=useState(""),[workspace,setWorkspace]=useState<Workspace>(),[page,setPage]=useState(currentPage);
  const [creating,setCreating]=useState(false),[name,setName]=useState(""),[busy,setBusy]=useState(false),[audit,setAudit]=useState<any[]>([]);
  const [invite,setInvite]=useState(()=>{const incoming=location.hash.startsWith("#invite=")?location.hash.slice(8):"";if(incoming){sessionStorage.setItem("oe.invite",incoming);history.replaceState(null,"","/app/");}return incoming||sessionStorage.getItem("oe.invite")||"";});
  const savingRef=useRef(false);
  const selectedRef=useRef(selected);selectedRef.current=selected;
  const ask=useReason(),toast=useToast();
  async function loadList(){const data=await request<typeof list>("/api/workspaces");setList(data);return data;}
  async function loadWorkspace(id:string){setWorkspace(undefined);const next=await request<Workspace>(`/api/workspaces/${id}`);if(selectedRef.current===id)setWorkspace(next);}
  async function refreshAccess(){const next=await loadList();if(!selected)return;try{await loadWorkspace(selected);}catch(e){if((e as {status?:number}).status===404){setWorkspace(undefined);setSelected(pick(next.filter(w=>w.id!==selected)));}else throw e;}}
  useEffect(()=>{let active=true;request("/api/session").then(async value=>{if(!active)return;setCsrf(value.csrf);setSession(value);identify(value.account.id);const workspaces=await loadList();if(active)setSelected(pick(workspaces));}).catch(e=>{if(e.status!==401)setError(e.message);}).finally(()=>{if(active)setReady(true);});return()=>{active=false;};},[]);
  useEffect(()=>{if(!selected)return;let active=true;
    // Stay current when the person returns to this window. An open form keeps its draft and revision.
    const onFocus=()=>{if(document.visibilityState!=="visible"||document.querySelector("main form.form"))return;request<Workspace>(`/api/workspaces/${selected}`).then(value=>{if(active&&selectedRef.current===selected)setWorkspace(value);}).catch(()=>{});};
    window.addEventListener("focus",onFocus);document.addEventListener("visibilitychange",onFocus);
    return()=>{active=false;window.removeEventListener("focus",onFocus);document.removeEventListener("visibilitychange",onFocus);};},[selected]);
  useEffect(()=>{if(!selected)return;remember(selected);let active=true;setWorkspace(undefined);request<Workspace>(`/api/workspaces/${selected}`).then(value=>{if(active)setWorkspace(value);}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[selected]);
  useEffect(()=>{const changed=()=>{if(location.hash.startsWith("#invite=")){const token=location.hash.slice(8);sessionStorage.setItem("oe.invite",token);setInvite(token);setError("");history.replaceState(null,"","/app/");setPage("Privilege Catalog");}else if(location.hash!=="#workspace-main")setPage(currentPage());};window.addEventListener("hashchange",changed);return()=>window.removeEventListener("hashchange",changed);},[]);
  useEffect(()=>{if(page!=="Audit"||!workspace)return;let active=true;request(`/api/workspaces/${workspace.id}/audit`).then(value=>{if(active)setAudit(value);}).catch(e=>setError(e.message));return()=>{active=false;};},[page,workspace]);
  const save:Save=async(section,entry,title,method="PUT")=>{
    if(!workspace||savingRef.current)return false;savingRef.current=true;
    setBusy(true);setError("");
    try{const reason=await ask(title);if(!reason)return false;const result=await request(`/api/workspaces/${workspace.id}/${section}`,method,{entry,revision:workspace.revision,reason});if(selectedRef.current===workspace.id)setWorkspace({...workspace,...result});toast("Changes saved");return true;}
    catch(e){setError((e as Error).message);return false;}finally{savingRef.current=false;setBusy(false);}
  };
  async function create(){const reason=await ask("Create workspace");if(!reason)return;setBusy(true);try{const value=await request<Workspace>("/api/workspaces","POST",{name,reason});await loadList();setSelected(value.id);setCreating(false);setName("");location.hash="catalog";}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
  async function accept(){setBusy(true);try{const value=await request("/api/invitations/accept","POST",{token:invite});sessionStorage.removeItem("oe.invite");setInvite("");await loadList();setSelected(value.workspaceId);setCreating(false);toast(value.alreadyMember?`Already a member. Your ${value.role} role is unchanged.`:"Workspace joined");}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
  if(!ready)return <main className="sign-in"><p role="status">Loading…</p></main>;
  if(!session)return <main className="sign-in"><picture><source srcSet="/logo-dark.svg" media="(prefers-color-scheme: dark)"/><img src="/logo.svg" alt="" width="48" height="48"/></picture><h1>Sign in to OpenEntitlement</h1><p>Manage your privileges, tiers, and customer access in one workspace.</p>{error&&<p role="alert" className="notice error">{error}</p>}<a className="btn primary" href="/auth/login">Sign in</a></main>;
  const current=list.find(w=>w.id===selected);
  const canEdit=workspace?.role==="Owner"||workspace?.role==="Platform administrator";
  return <div className="shell workspace-shell"><a className="skip-link" href="#workspace-main">Skip to workspace</a><aside>{!creating&&current?<WorkspaceSwitcher workspaces={list} current={current} disabled={busy} onSelect={id=>{setSelected(id);setError("");}} onCreate={()=>{setCreating(true);setError("");}}/>:<a className="brand" href="/app/"><picture><source srcSet="/logo-dark.svg" media="(prefers-color-scheme: dark)"/><img src="/logo.svg" alt="" width="32" height="32"/></picture><span>OpenEntitlement</span></a>}
    {selected&&!creating&&<nav aria-label="Workspace navigation">{pages.map(p=><a className={`nav ${page===p?"active":""}`} aria-current={page===p?"page":undefined} aria-label={p} href={`#${p==="Privilege Catalog"?"catalog":p.toLowerCase()}`} key={p}><span>{p}</span></a>)}</nav>}
    <div className="sidebar-footer"><p>{session.account.email}{session.account.platformAdmin&&<small>Platform administrator</small>}</p><button className="btn" onClick={()=>void request("/auth/logout","POST").then(()=>{resetIdentity();setCsrf("");setSession(undefined);setWorkspace(undefined);setSelected("");setCreating(false);setList([]);}).catch(e=>setError(e.message))}>Sign out</button></div></aside>
    <main id="workspace-main" tabIndex={-1}>
      {error&&<div role="alert" className="notice error">{error}{selected&&<button className="btn" onClick={()=>{setError("");void loadWorkspace(selected).catch(e=>setError(e.message));}}>Refresh workspace</button>}</div>}
      {invite&&<section className="panel invitation"><h2>You have a workspace invitation</h2><p>Join using the verified email address you signed in with.</p><button className="btn primary" disabled={busy} onClick={()=>void accept()}>Join workspace</button><button className="btn" disabled={busy} onClick={()=>{sessionStorage.removeItem("oe.invite");setInvite("");setError("");}}>Dismiss invitation</button></section>}
      {(creating||!selected)&&<form className="panel workspace-create" onSubmit={e=>{e.preventDefault();void create();}}><h1>Create a workspace</h1><p>A workspace holds one product’s privileges, tiers and Organizations. To join an existing one, open the invitation link its Owner sent you.</p><FormField label="Workspace name"><input required maxLength={200} value={name} onChange={e=>setName(e.target.value)} /></FormField><div className="form-actions">{selected&&<button type="button" className="btn" onClick={()=>setCreating(false)}>Cancel</button>}<button className="btn primary" disabled={busy}>{busy?"Creating…":"Create workspace"}</button></div></form>}
      {selected&&!creating&&!workspace&&!error&&<p role="status" className="notice">Loading workspace…</p>}
      {workspace&&!creating&&<><div className="page-heading"><div><h1>{page}</h1><p>{page==="Privilege Catalog"?"What your product allows or limits.":page==="Tiers"?"Build reusable offers from your privilege defaults.":page==="Organizations"?"Assign access and record customer-specific terms.":page==="Audit"?"Every change records who made it and why.":page==="Configuration"?"A read-only YAML snapshot of this workspace.":"Manage workspace access and application credentials."}</p></div></div>
      {page==="Privilege Catalog"&&<Catalog key={workspace.id} workspace={workspace} save={save} canEdit={canEdit} busy={busy}/>}
      {page==="Tiers"&&<Tiers key={workspace.id} workspace={workspace} save={save} canEdit={canEdit} busy={busy}/>}
      {page==="Organizations"&&<Organizations key={workspace.id} workspace={workspace} save={save} canEdit={canEdit} busy={busy}/>}
      {page==="Configuration"&&<WorkspaceConfiguration workspace={workspace}/>}
      {page==="Settings"&&<WorkspaceSettings key={workspace.id} workspace={workspace} save={save} account={session.account} busy={busy} refreshAccess={refreshAccess}/>}
      {page==="Audit"&&<section className="panel overflow"><table><thead><tr><th>When</th><th>Account</th><th>Action</th><th>Reason</th></tr></thead><tbody>{audit.map(a=><tr key={a.id}><td>{new Date(a.at).toLocaleString()}</td><td><code>{a.actor}</code></td><td>{a.action}</td><td>{a.reason}</td></tr>)}</tbody></table>{!audit.length&&<p>No changes recorded yet.</p>}</section>}
      </>}
    </main></div>;
}
