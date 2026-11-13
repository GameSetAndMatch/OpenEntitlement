import { useEffect, useRef, useState } from "react";
import { request,setCsrf } from "./client.ts";
import { identify, resetIdentity } from "../telemetry.ts";
import { Catalog } from "./catalog.tsx";
import { Tiers } from "./tiers.tsx";
import { Organizations } from "./organizations.tsx";
import { WorkspaceSettings,WorkspaceConfiguration } from "./settings.tsx";
import { changesContractTerms,STALE_REVISION,type WorkspaceData } from "../../../server/workspace/model.ts";
import { useReason,useToast } from "../ui.tsx";
import { WorkspaceSwitcher } from "./workspace-switcher.tsx";
import { FormField } from "../form.tsx";
import "./style.css";
export interface Workspace {hosting?:{mode:"self_hosted"|"saas";tier:"pro"|"enterprise";subjectEntitlements:boolean};id:string;name:string;role:string;data:WorkspaceData;revision:number;environment?:import("../../../server/environment.ts").EnvironmentOverrides}
export type Save=(section:string,entry:unknown,title:string,method?:"PUT"|"DELETE")=>Promise<boolean>;
// The workspace's daily pages. Administration lives in Settings, which swaps the sidebar (as in Linear).
const pages=[
  {name:"Privilege Catalog",hash:"catalog",about:"What your product allows or limits."},
  {name:"Tiers",hash:"tiers",about:"Build reusable offers from your privilege defaults."},
  {name:"Organizations",hash:"organizations",about:"Assign access and record customer-specific terms."},
];
const settingsPages=[
  {name:"Members",hash:"settings/members",about:"Who can manage this workspace."},
  {name:"API keys",hash:"settings/api-keys",about:"Connect your application to this workspace."},
  {name:"Service",hash:"settings/service",about:"How OpenEntitlement runs this workspace."},
  {name:"Configuration",hash:"settings/configuration",about:"A read-only YAML snapshot of this workspace."},
  {name:"Audit log",hash:"settings/audit-log",about:"Every change records who made it. Changes to contract terms also record why."},
];
const allPages=[...pages,...settingsPages];
// Links from before Settings had its own sidebar.
const legacy:Record<string,string>={settings:"Members",configuration:"Configuration",audit:"Audit log"};
// The last workspace this browser used. A convenience only: the list from the server decides access.
const LAST_WORKSPACE="oe.workspace";
function rememberedWorkspace(){try{return localStorage.getItem(LAST_WORKSPACE)??"";}catch{return "";}}
function remember(id:string){try{if(id)localStorage.setItem(LAST_WORKSPACE,id);else localStorage.removeItem(LAST_WORKSPACE);}catch{/* storage unavailable */}}
function pick(list:Array<{id:string}>,preferred=rememberedWorkspace()){return list.find(w=>w.id===preferred)?.id??list[0]?.id??"";}
function currentPage(){const hash=location.hash.slice(1);return allPages.find(p=>p.hash===hash)?.name??(Object.hasOwn(legacy,hash)?legacy[hash]:undefined)??"Privilege Catalog";}
export function WorkspaceApp(){
  const [session,setSession]=useState<any>(),[ready,setReady]=useState(false),[error,setErrorState]=useState<{message:string;refresh:boolean}>({message:"",refresh:false});
  // Offer "Refresh workspace" only when reloading can fix the error: a stale revision or a failed load.
  const setError=(message:string,refresh=false)=>setErrorState({message,refresh});
  const failed=(e:unknown)=>{const {message,status}=e as {message:string;status?:number};setError(message,status===409&&message===STALE_REVISION);};
  const [list,setList]=useState<Array<{id:string;name:string;role:string}>>([]),[selected,setSelected]=useState(""),[workspace,setWorkspace]=useState<Workspace>(),[page,setPage]=useState(currentPage);
  const [creating,setCreating]=useState(false),[name,setName]=useState(""),[busy,setBusy]=useState(false),[audit,setAudit]=useState<any[]>([]);
  const [invite,setInvite]=useState(()=>{const incoming=location.hash.startsWith("#invite=")?location.hash.slice(8):"";if(incoming){sessionStorage.setItem("oe.invite",incoming);history.replaceState(null,"","/app/");}return incoming||sessionStorage.getItem("oe.invite")||"";});
  const savingRef=useRef(false);
  const selectedRef=useRef(selected);selectedRef.current=selected;
  // Saves read the newest revision, so a flow can save twice in a row (a tier, then its first variant).
  const workspaceRef=useRef(workspace);workspaceRef.current=workspace;
  const ask=useReason(),toast=useToast();
  async function loadList(){const data=await request<typeof list>("/api/workspaces");setList(data);return data;}
  async function loadWorkspace(id:string){setWorkspace(undefined);const next=await request<Workspace>(`/api/workspaces/${id}`);if(selectedRef.current===id)setWorkspace(next);}
  // Access to the open workspace ended (another Owner removed you, or it was deleted): move to another one.
  async function lostAccess(id:string){const next=await loadList();if(selectedRef.current!==id)return;setWorkspace(undefined);setError("");setSelected(pick(next.filter(w=>w.id!==id)));toast("You no longer have access to that workspace");}
  const isGone=(e:unknown)=>(e as {status?:number}).status===404;
  async function refreshAccess(){const next=await loadList();if(!selected)return;try{await loadWorkspace(selected);}catch(e){if((e as {status?:number}).status===404){setWorkspace(undefined);setSelected(pick(next.filter(w=>w.id!==selected)));}else throw e;}}
  useEffect(()=>{let active=true;request("/api/session").then(async value=>{if(!active)return;setCsrf(value.csrf);setSession(value);identify(value.account.id);const workspaces=await loadList();if(active)setSelected(pick(workspaces));}).catch(e=>{if(e.status!==401)setError(e.message);}).finally(()=>{if(active)setReady(true);});return()=>{active=false;};},[]);
  useEffect(()=>{if(!selected)return;let active=true;
    // Stay current when the person returns to this window. An open form keeps its draft and revision.
    const onFocus=()=>{if(document.visibilityState!=="visible"||document.querySelector("main form.form"))return;request<Workspace>(`/api/workspaces/${selected}`).then(value=>{if(active&&selectedRef.current===selected)setWorkspace(value);}).catch(e=>{if(active&&isGone(e))void lostAccess(selected);});};
    window.addEventListener("focus",onFocus);document.addEventListener("visibilitychange",onFocus);
    return()=>{active=false;window.removeEventListener("focus",onFocus);document.removeEventListener("visibilitychange",onFocus);};},[selected]);
  useEffect(()=>{if(!selected)return;remember(selected);let active=true;setWorkspace(undefined);request<Workspace>(`/api/workspaces/${selected}`).then(value=>{if(active)setWorkspace(value);}).catch(e=>{if(!active)return;if(isGone(e))void lostAccess(selected);else setError(e.message,true);});return()=>{active=false;};},[selected]);
  // Following "Settings" or "Back to workspace" swaps the sidebar and removes the focused link. Keep focus on the current page's link.
  const navigated=useRef(false);
  useEffect(()=>{if(!navigated.current)return;navigated.current=false;if(document.activeElement&&document.activeElement!==document.body)return;document.querySelector<HTMLElement>('aside nav a[aria-current="page"]')?.focus();},[page]);
  useEffect(()=>{const changed=()=>{if(location.hash.startsWith("#invite=")){const token=location.hash.slice(8);sessionStorage.setItem("oe.invite",token);setInvite(token);setError("");history.replaceState(null,"","/app/");setPage("Privilege Catalog");}else if(location.hash!=="#workspace-main"){navigated.current=true;setError("");setPage(currentPage());}};window.addEventListener("hashchange",changed);return()=>window.removeEventListener("hashchange",changed);},[]);
  useEffect(()=>{if(page!=="Audit log"||!workspace)return;let active=true;request(`/api/workspaces/${workspace.id}/audit`).then(value=>{if(active)setAudit(value);}).catch(e=>setError(e.message));return()=>{active=false;};},[page,workspace]);
  const save:Save=async(section,entry,title,method="PUT")=>{
    const workspace=workspaceRef.current;
    if(!workspace||savingRef.current)return false;savingRef.current=true;
    setBusy(true);setError("");
    try{let reason:string|null="";if(changesContractTerms(workspace.data,section,entry)){reason=await ask(title);if(!reason)return false;}const result=await request(`/api/workspaces/${workspace.id}/${section}`,method,{entry,revision:workspace.revision,...(reason?{reason}:{})});if(selectedRef.current===workspace.id){const next={...workspace,...result};workspaceRef.current=next;setWorkspace(next);}toast("Changes saved");return true;}
    catch(e){failed(e);return false;}finally{savingRef.current=false;setBusy(false);}
  };
  async function create(){setBusy(true);try{const value=await request<Workspace>("/api/workspaces","POST",{name});await loadList();setSelected(value.id);setCreating(false);setName("");location.hash="catalog";}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
  async function accept(){setBusy(true);try{const value=await request("/api/invitations/accept","POST",{token:invite});sessionStorage.removeItem("oe.invite");setInvite("");await loadList();setSelected(value.workspaceId);setCreating(false);toast(value.alreadyMember?`Already a member. Your ${value.role} role is unchanged.`:"Workspace joined");}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
  if(!ready)return <main className="sign-in"><p role="status">Loading…</p></main>;
  if(!session)return <main className="sign-in"><picture><source srcSet="/logo-dark.svg" media="(prefers-color-scheme: dark)"/><img src="/logo.svg" alt="" width="48" height="48"/></picture><h1>Sign in to OpenEntitlement</h1><p>Manage your privileges, tiers, and customer access in one workspace.</p>{error.message&&<p role="alert" className="notice error">{error.message}</p>}<a className="btn primary" href="/auth/login">Sign in</a></main>;
  const current=list.find(w=>w.id===selected);
  const canEdit=workspace?.role==="Owner"||workspace?.role==="Platform administrator";
  // API keys are an Owner's page; anyone else lands on Members instead.
  const visibleSettings=settingsPages.filter(p=>p.name!=="API keys"||canEdit);
  const shown=allPages.find(p=>p.name===page&&(p.name!=="API keys"||canEdit))??settingsPages[0]!;
  const inSettings=settingsPages.includes(shown);
  const link=(p:typeof allPages[number])=><a className={`nav ${shown===p?"active":""}`} aria-current={shown===p?"page":undefined} href={`#${p.hash}`} key={p.hash}>{p.name}</a>;
  return <div className="shell workspace-shell"><a className="skip-link" href="#workspace-main">Skip to workspace</a><aside>{!creating&&current?<WorkspaceSwitcher workspaces={list} current={current} disabled={busy} onSelect={id=>{setSelected(id);setError("");}} onCreate={()=>{setCreating(true);setError("");}}/>:<a className="brand" href="/app/"><picture><source srcSet="/logo-dark.svg" media="(prefers-color-scheme: dark)"/><img src="/logo.svg" alt="" width="32" height="32"/></picture><span>OpenEntitlement</span></a>}
    {selected&&!creating&&(inSettings
      ?<><a className="settings-back" href="#catalog"><span aria-hidden="true">‹</span> Back to workspace</a><nav aria-label="Settings"><p className="nav-heading" aria-hidden="true">Settings</p>{visibleSettings.map(link)}</nav></>
      :<><nav aria-label="Workspace navigation">{pages.map(link)}</nav><a className="nav settings-link" href="#settings/members">Settings</a></>)}
    <div className="sidebar-footer"><p>{session.account.email}{session.account.platformAdmin&&<small>Platform administrator</small>}</p><button className="btn" onClick={()=>void request("/auth/logout","POST").then(()=>{resetIdentity();remember("");setCsrf("");setSession(undefined);setWorkspace(undefined);setSelected("");setCreating(false);setList([]);}).catch(e=>setError(e.message))}>Sign out</button></div></aside>
    <main id="workspace-main" tabIndex={-1}>
      {error.message&&<div role="alert" className="notice error">{error.message}{selected&&error.refresh&&<button className="btn" onClick={()=>{setError("");void loadWorkspace(selected).catch(e=>{if(isGone(e))void lostAccess(selected);else setError(e.message,true);});}}>Refresh workspace</button>}</div>}
      {invite&&<section className="panel invitation"><h2>You have a workspace invitation</h2><p>Join using the verified email address you signed in with.</p><button className="btn primary" disabled={busy} onClick={()=>void accept()}>Join workspace</button><button className="btn" disabled={busy} onClick={()=>{sessionStorage.removeItem("oe.invite");setInvite("");setError("");}}>Dismiss invitation</button></section>}
      {(creating||!selected)&&<form className="panel workspace-create" onSubmit={e=>{e.preventDefault();void create();}}><h1>Create a workspace</h1><p>A workspace holds one product’s privileges, tiers and Organizations. To join an existing one, open the invitation link its Owner sent you.</p><FormField label="Workspace name"><input required autoFocus={creating} maxLength={200} value={name} onChange={e=>setName(e.target.value)} /></FormField><div className="form-actions">{selected&&<button type="button" className="btn" onClick={()=>{setCreating(false);requestAnimationFrame(()=>document.querySelector<HTMLElement>(".workspace-trigger")?.focus());}}>Cancel</button>}<button className="btn primary" disabled={busy}>{busy?"Creating…":"Create workspace"}</button></div></form>}
      {selected&&!creating&&!workspace&&!error.message&&<p role="status" className="notice">Loading workspace…</p>}
      {workspace&&!creating&&<><div className="page-heading"><div><h1>{shown.name}</h1><p>{shown.about}</p></div></div>
      {shown.name==="Privilege Catalog"&&<Catalog key={workspace.id} workspace={workspace} save={save} canEdit={canEdit} busy={busy}/>}
      {shown.name==="Tiers"&&<Tiers key={workspace.id} workspace={workspace} save={save} canEdit={canEdit} busy={busy}/>}
      {shown.name==="Organizations"&&<Organizations key={workspace.id} workspace={workspace} save={save} canEdit={canEdit} busy={busy}/>}
      {shown.name==="Configuration"&&<WorkspaceConfiguration workspace={workspace}/>}
      {(shown.name==="Members"||shown.name==="API keys"||shown.name==="Service")&&<WorkspaceSettings key={workspace.id} section={shown.name} workspace={workspace} save={save} account={session.account} busy={busy} refreshAccess={refreshAccess}/>}
      {shown.name==="Audit log"&&<section className="panel overflow"><table><thead><tr><th>When</th><th>Account</th><th>Action</th><th>Reason</th></tr></thead><tbody>{audit.map(a=><tr key={a.id}><td>{new Date(a.at).toLocaleString()}</td><td><code>{a.actor}</code></td><td>{a.action}</td><td>{a.reason||"—"}</td></tr>)}</tbody></table>{!audit.length&&<p>No changes recorded yet.</p>}</section>}
      </>}
    </main></div>;
}
