import { useEffect,useRef,useState } from "react";
import { trackWrite,useUnsavedChanges } from "./unsaved.ts";
import { Field,Group,Item,Row } from "./settings-group.tsx";
import { configurationYaml,type SnapshotProduct } from "./configuration.ts";
import { request } from "./client.ts";
import type { Workspace,Save } from "./app.tsx";
import { useConfirm,useToast } from "../ui.tsx";
import { ProductApiKeys } from "./product-api-keys.tsx";
import type { ProductSummary } from "./product-selector.tsx";
import { ProductMembers,managesMembers,type MemberRoleChange,type NewInvitation,type ProductMember } from "./product-members.tsx";
/** `product` is the Product the selector shows on the Python service: API keys belong to it. */
export function WorkspaceSettings({section,workspace:w,save,account,busy,refreshAccess,product}:{section:"Members"|"API keys"|"Service";workspace:Workspace;save:Save;product?:ProductSummary;account:{id:string;email:string;platformAdmin:boolean};busy:boolean;refreshAccess:()=>Promise<void>}){
  const [members,setMembers]=useState<any[]>([]),[keys,setKeys]=useState<any[]>([]),[email,setEmail]=useState(""),[role,setRole]=useState("User"),[link,setLink]=useState(""),[secret,setSecret]=useState(""),[name,setName]=useState(""),[error,setError]=useState("");
  const [pending,setPending]=useState(false);const pendingRef=useRef(false);
  // An error belongs to the page it happened on; it does not follow the person to another settings page.
  const sectionGeneration=useRef(0);
  // Leaving a section discards what was typed in it (the console asked first), and a secret is shown once.
  // The page is keyed by Product, so changing Product starts it afresh.
  useEffect(()=>{sectionGeneration.current++;setError("");setEmail("");setName("");setSecret("");},[section]);
  const locked=busy||pending;
  const [hostedTier,setHostedTier]=useState(w.hosting?.tier??"pro");
  useEffect(()=>setHostedTier(w.hosting?.tier??"pro"),[w.hosting?.tier,section]);
  useUnsavedChanges(true,{email,name,hostedTier:hostedTier!==(w.hosting?.tier??"pro")});
  const confirm=useConfirm(),toast=useToast();
  // The Python service has Roles per Product: a Manager of any Product manages its members.
  const python=w.products!==undefined;
  const owner=w.role==="Owner"||w.role==="Platform administrator",manager=owner||(python?w.products!.some(managesMembers):w.role==="Manager");
  const base=`/api/workspaces/${w.id}`;
  // On the Python service, the selected Product's Managers and the Owners administer its API keys (OPE-42).
  const keysPath=python&&product&&(owner||product.role==="Manager")?`${base}/products/${product.id}/api-keys`:undefined;
  // Every load takes a generation number; only the newest one may update the lists.
  const generation=useRef(0);
  async function load(){const mine=++generation.current;const m=manager?await request(base+"/members"):[];const k=keysPath?await request(keysPath):owner&&!python?await request(base+"/keys"):[];if(mine===generation.current){setMembers(m);setKeys(k);}}
  async function reload(){await load();}
  // Keys of the previously selected Product never show while this one's load.
  useEffect(()=>{let active=true;setKeys([]);const refresh=async()=>{try{await load();}catch(e){if(active)setError((e as Error).message);}};void refresh();
    // Stay current without a refresh button: reload when the person comes back to this window.
    const onFocus=()=>{if(document.visibilityState==="visible")void refresh();};window.addEventListener("focus",onFocus);document.addEventListener("visibilitychange",onFocus);
    return()=>{active=false;generation.current++;window.removeEventListener("focus",onFocus);document.removeEventListener("visibilitychange",onFocus);};
  },[base,manager,owner,keysPath]); // load reads exactly base, manager, owner and keysPath
  // Settings changes are audited with their actor; only removals ask to confirm.
  // A write already sent may still commit; leaving the section waits for it (see unsaved.ts).
  async function mutate(label:string,action:(reason:string)=>Promise<void|"access-changed">,ask=false){if(pendingRef.current||busy)return false;pendingRef.current=true;setPending(true);const generation=sectionGeneration.current;try{if(ask&&!await confirm(label))return false;setError("");const result=await trackWrite(action(""));if(result!=="access-changed")await reload();toast("Changes saved");return true;}catch(e){if(generation===sectionGeneration.current)setError((e as Error).message);return false;}finally{pendingRef.current=false;setPending(false);}}
  // Changing your own access reloads your Workspace and Roles instead of this list.
  const afterOwnChange=async(id:string)=>{if(id===account.id&&!account.platformAdmin){await refreshAccess();return "access-changed" as const;}};
  const changeRole=(m:ProductMember,change:MemberRoleChange)=>void mutate("Change member role",async()=>{await request(base+"/members/"+m.id,"PUT",change);return afterOwnChange(m.id);});
  const removeMember=(m:ProductMember)=>void mutate(`Remove ${m.email} from ${owner?"this workspace":"the Products you manage"}?`,async()=>{await request(base+"/members/"+m.id,"DELETE");return afterOwnChange(m.id);},true);
  const invite=(invitation:NewInvitation)=>mutate("Invite member",async()=>{const result=await request(base+"/invitations","POST",invitation);setLink(location.origin+"/app/#invite="+result.token);});
  const saveTier=()=>void mutate("Change Cloud service tier",async()=>{await request(base+"/service-tier","PUT",{tier:hostedTier,version:w.version});await refreshAccess();return "access-changed";});
  const tierChanged=hostedTier!==(w.hosting?.tier??"pro");
  const roleSelect=(m:{id:string;email:string;role:string})=><select className="fit" disabled={locked} aria-label={`Role for ${m.email}`} value={m.role} onChange={e=>{const nextRole=e.target.value;void mutate("Change member role",async reason=>{await request(base+"/members","PUT",{accountId:m.id,role:nextRole,reason});if(m.id===account.id&&!account.platformAdmin){await refreshAccess();return "access-changed";}});}}>{["Owner","Manager","User"].map(r=><option key={r}>{r}</option>)}</select>;
  const copy=(text:string,done:string)=>void navigator.clipboard.writeText(text).then(()=>toast(done)).catch(()=>setError("Copy failed. Select and copy it manually."));
  return <div className="settings-page">{error&&<p role="alert" className="notice error">{error}</p>}
    {section==="Members"&&python&&(manager
      ?<ProductMembers description={account.platformAdmin?"As a Platform administrator, you can manage every workspace.":`Your role: ${w.role}.`} members={members} products={w.products!} viewer={account.id} owner={owner} locked={locked} link={link} onRole={changeRole} onRemove={removeMember} onInvite={invite}/>
      :<Group description={`Your role: ${w.role}.`}>{null}</Group>)}
    {section==="Members"&&!python&&<><Group description={account.platformAdmin?"As a Platform administrator, you can manage every workspace.":`Your role: ${w.role}.`}>
      {manager&&members.map(m=><Item key={m.id} label={<span className="member"><span className="member-mark" aria-hidden="true">{m.email.slice(0,1).toUpperCase()}</span><span className="member-email">{m.email}</span>{m.id===account.id&&<span className="member-you">You</span>}</span>}>
        {owner?roleSelect(m):<span className="settings-value">{m.role}</span>}
        {(owner||m.role!=="Owner")&&<button className="btn-quiet danger" disabled={locked} aria-label={`Remove ${m.email}`} onClick={()=>void mutate(`Remove ${m.email} from this workspace?`,async reason=>{await request(base+"/members","PUT",{accountId:m.id,role:null,reason});if(m.id===account.id){await refreshAccess();return "access-changed";}},true)}>Remove</button>}
      </Item>)}
    </Group>
    {manager&&<Group title="Invite a member" description="They get a link that expires in 7 days.">
      <form aria-label="Invite a member" onSubmit={e=>{e.preventDefault();void mutate("Invite workspace member",async reason=>{const result=await request(base+"/invitations","POST",{email,role,reason});setLink(location.origin+"/app/#invite="+result.token);setEmail("");});}}>
        <div className="settings-row settings-inline"><input type="email" required aria-label="Email address" placeholder="name@company.com" value={email} onChange={e=>setEmail(e.target.value)}/><select className="fit" aria-label="Role" value={role} onChange={e=>setRole(e.target.value)}>{(owner?["User","Manager","Owner"]:["User","Manager"]).map(r=><option key={r}>{r}</option>)}</select><button className="btn" disabled={locked}>Create invitation link</button></div>
      </form>
      {link&&<Field label="Invitation link (expires in 7 days)" hint="Share it with the invited person. They must sign in with that verified email address."><input readOnly value={link} onFocus={e=>e.target.select()}/></Field>}
    </Group>}</>}
    {section==="API keys"&&keysPath&&product&&<ProductApiKeys product={product} keys={keys} name={name} secret={secret} locked={locked} onName={setName} onCopy={copy}
      onCreate={()=>void mutate("Create API key",async()=>{const result=await request(keysPath,"POST",{name});setSecret(result.secret);setName("");})}
      onRevoke={k=>void mutate(`Revoke ${k.name}? Applications using it stop working.`,async()=>{await request(`${keysPath}/${k.id}`,"DELETE");},true)}/>}
    {section==="API keys"&&owner&&!python&&<><Group description="Your application evaluates entitlements in this workspace with these keys.">
      <Item label="Workspace ID" description="Identifies this workspace in the API and in support requests."><code className="settings-value">{w.id}</code><button className="btn-quiet" onClick={()=>copy(w.id,"Workspace ID copied")}>Copy</button></Item>
      {keys.map(k=><Item key={k.id} label={k.name} description={<><code>{k.prefix}…</code> · {k.revoked?"Revoked":k.scope}</>}>{!k.revoked&&<button className="btn-quiet danger" disabled={locked} aria-label={`Revoke ${k.name}`} onClick={()=>void mutate(`Revoke ${k.name}? Applications using it stop working.`,async reason=>{await request(base+"/keys/"+k.id,"DELETE",{reason});},true)}>Revoke</button>}</Item>)}
    </Group>
    <Group title="Create a key">
      <form aria-label="Create an evaluation key" onSubmit={e=>{e.preventDefault();void mutate("Create evaluation key",async reason=>{const result=await request(base+"/keys","POST",{name,scope:"evaluate",reason});setSecret(result.secret);setName("");});}}>
        <Row label="Key name" description="Create one key per application. Its secret is shown only once.">{[<input key="name" required value={name} onChange={e=>setName(e.target.value)}/>,<button key="create" className="btn" disabled={locked}>Create evaluation key</button>]}</Row>
      </form>
      {secret&&<Field label="Save this secret securely" hint="It will not be shown again."><input readOnly type="password" value={secret} onFocus={e=>e.target.select()}/></Field>}
      {secret&&<Item label="Copy the secret to your application’s configuration."><button className="btn" onClick={()=>copy(secret,"API key copied")}>Copy key</button></Item>}
    </Group></>}
    {section==="Service"&&<Group description="The OpenEntitlement service this workspace runs on. It is separate from the Tiers you sell to your customers.">
      {account.platformAdmin&&w.hosting?.mode==="saas"?<form onSubmit={e=>{e.preventDefault();if(python)saveTier();else void save("hosting",{tier:hostedTier},"Change Cloud service tier");}}>
        <Row label="Cloud service tier" description="Pro allows one Product. Enterprise allows any number and adds entitlements for individual users inside an Organization."><select className="fit" value={hostedTier} onChange={e=>setHostedTier(e.target.value as "pro"|"enterprise")}><option value="pro">Pro</option><option value="enterprise">Enterprise</option></select></Row>
        {tierChanged&&<div className="settings-row settings-save"><button type="button" className="btn" disabled={locked} onClick={()=>setHostedTier(w.hosting?.tier??"pro")}>Cancel</button><button className="btn primary" disabled={locked}>Save Cloud service tier</button></div>}
      </form>:<Item label={w.hosting?.mode==="saas"?`Cloud ${w.hosting.tier==="enterprise"?"Enterprise":"Pro"}`:"Self-hosted"} description={w.hosting?.subjectEntitlements?"Entitlements for Organizations and their users.":"Entitlements for Organizations."}/>}
    </Group>}
  </div>;
}
/** The read-only YAML snapshot. On the Python service it covers the selected Product. */
export function WorkspaceConfiguration({workspace:w,product}:{workspace:Workspace;product?:SnapshotProduct}){
  const yaml=configurationYaml(w,product),name=product?`${product.name} YAML`:"Workspace YAML";
  function download(){const url=URL.createObjectURL(new Blob([yaml],{type:"application/yaml"})),a=document.createElement("a");a.href=url;a.download=product?`${product.key}.yaml`:"workspace.yaml";a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  return <section className="panel configuration-panel"><div className="section-title"><h2>{name}</h2><button className="btn" onClick={download}>Download YAML</button></div><p>Includes the catalog, tiers and variants, Organization terms, and application users’ personal terms and grants{product?` in ${product.name}`:""}. Excludes hidden privileges, environment values, members and API keys.</p><pre className="configuration-code" tabIndex={0} aria-label={name}><code>{yaml}</code></pre></section>;
}
