import { productEvent } from "../telemetry.ts";
import { z } from "zod";
import { deploymentMode, hosting, requireSubjectEntitlements } from "./hosting.ts";
import { subject, subjectIdentifier, validateSubjects } from "./subjects.ts";
import {parsePrivilege} from "./privilege-definition.ts";
import {storedDefinition,catalogDefinition} from "./catalog-adapter.ts";
import type { IncomingMessage, ServerResponse } from "node:http";
import { readJson, send } from "../http.ts";
import { Authentication } from "./auth.ts";
import { WorkspaceStore } from "./store.ts";
import { WorkspaceError, object, text, group, feature, privilege, tag, tier, variant, organization, resolve, catalogEnvironment, type StatusPolicy } from "./model.ts";

export function workspaceApi(auth: Authentication,store: WorkspaceStore,env:NodeJS.ProcessEnv={...process.env}) {
  const mode=deploymentMode(env);
  const view=<T extends {data:import("./model.ts").WorkspaceData}>(workspace:T)=>({...workspace,hosting:hosting(workspace.data,mode),environment:catalogEnvironment(workspace.data,env)});
  const evaluate=(data:import("./model.ts").WorkspaceData,b:Record<string,any>)=>{
    const id=b.subjectId===undefined?undefined:subjectIdentifier(b.subjectId);
    if(id!==undefined)requireSubjectEntitlements(data,mode);
    const now=b.now===undefined?new Date():z.iso.datetime({offset:true}).safeParse(b.now).success?new Date(b.now):new Date(NaN);
    if(!Number.isFinite(now.getTime()))throw new WorkspaceError('Evaluation time must be an RFC 3339 timestamp with a timezone');
    return resolve(data,text(b.organizationId,'Organization'),text(b.privilege,'Privilege'),now,catalogEnvironment(data,env),id);
  };
  const evaluatedWorkspaces=new Set<string>();
  return async (req: IncomingMessage,res: ServerResponse) => {
    const url=new URL(req.url ?? "/",auth.config.appUrl),path=url.pathname,method=req.method;
    if (path === "/auth/login" && method === "GET") { await auth.login(res); return true; }
    if (path === "/auth/callback" && method === "GET") { await auth.callback(req,res);return true; }
    if (!path.startsWith("/api/") && path !== "/auth/logout") return false;
    // Application keys have a distinct data plane; they can never become console sessions.
    if (path === "/api/evaluate" && method === "POST") {
      const key=await store.key(req.headers.authorization?.replace(/^Bearer /,"") ?? "");
      if (!key || key.scope !== "evaluate") throw new WorkspaceError("Invalid evaluation key",401);
      const b=object(await readJson(req));
      const data=await store.keyData(key.workspace_id);const result=evaluate(data,b);
      // The activation step: an application evaluated with a key. Reported once per Workspace per process, not per call.
      if(!evaluatedWorkspaces.has(key.workspace_id)){evaluatedWorkspaces.add(key.workspace_id);productEvent(key.created_by,"api_evaluation_served",{workspace_id:key.workspace_id});}
      send(res,200,result);return true;
    }
    const session=await auth.session(req),account=session.account;
    if (method !== "GET") auth.csrf(req,session);
    if (path === "/auth/logout" && method === "POST") { await auth.logout(req,res,session);return true; }
    if (path === "/api/session" && method === "GET") { send(res,200,{account,csrf:session.csrf});return true; }
    if (path === "/api/workspaces" && method === "GET") { send(res,200,await store.list(account));return true; }
    const body=method === "GET" ? {} : object(await readJson(req));
    const reason=() => text(body.reason,"Reason",2000);
    if (path === "/api/workspaces" && method === "POST") { const created=view(await store.create(account,text(body.name,"Workspace name"),reason()));productEvent(account.id,"workspace_created",{workspace_id:created.id});send(res,201,created);return true; }
    if (path === "/api/invitations/accept" && method === "POST") { const accepted=await store.acceptInvite(account,text(body.token,"Invitation token"));productEvent(account.id,"invitation_accepted");send(res,200,accepted);return true; }
    const match=/^\/api\/workspaces\/([^/]+)(?:\/(groups|tags|catalog|features|privileges|tiers|variants|organizations|policy|audit|members|invitations|keys|evaluate|subjects|hosting))?(?:\/([^/]+))?$/.exec(path);
    if (!match) throw new WorkspaceError("Endpoint not found",404);
    const [,id,section,target]=match;
    if (!section && method === "GET") { const workspace=await store.read(account,id!);send(res,200,view(workspace));return true; }
    if(section==="catalog"&&method==="GET"){const workspace=await store.read(account,id!);send(res,200,{privileges:workspace.data.privileges.map(p=>catalogDefinition(p,workspace.data)),groups:workspace.data.groups.map(g=>({id:g.id,title:g.name,description:g.description,...(g.parentId?{parentId:g.parentId}:{})})),tags:workspace.data.tags.map(t=>({id:t.id,title:t.name,description:t.description}))});return true;}
    if (section === "audit" && method === "GET") { send(res,200,await store.history(account,id!));return true; }
    if (section === "invitations" && method === "POST") {
      if (!["Owner","Manager","User"].includes(body.role))throw new WorkspaceError("Invalid role");
      const email=text(body.email,"Email");if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw new WorkspaceError("Enter a valid email address");
      const invited=await store.invite(account,id!,email,body.role,reason());productEvent(account.id,"member_invited",{workspace_id:id,role:body.role});send(res,201,invited);return true;
    }
    if (section === "members" && method === "GET") { send(res,200,await store.members(account,id!));return true; }
    if (section === "members" && method === "PUT") {
      if (body.role !== null && !["Owner","Manager","User"].includes(body.role)) throw new WorkspaceError("Invalid role");
      const accountId=text(body.accountId,"Account ID");
      if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(accountId)) throw new WorkspaceError("Invalid Account ID");
      await store.setMember(account,id!,accountId,body.role,reason());productEvent(account.id,body.role===null?"member_removed":"member_role_changed",{workspace_id:id,role:body.role});send(res,200,{});return true;
    }
    if (section === "keys" && method === "GET") { send(res,200,await store.keys(account,id!));return true; }
    if (section === "keys" && method === "POST") {
      if (body.scope !== "evaluate") throw new WorkspaceError("Invalid key scope");
      const key=await store.createKey(account,id!,text(body.name,"Key name"),body.scope,reason());productEvent(account.id,"api_key_created",{workspace_id:id,scope:body.scope});send(res,201,key);return true;
    }
    if (section === "keys" && target && method === "DELETE") { if(!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(target))throw new WorkspaceError("API key not found",404); await store.revokeKey(account,id!,target,reason());productEvent(account.id,"api_key_revoked",{workspace_id:id});send(res,200,{});return true; }
    if (section === "evaluate" && method === "POST") { const workspace=await store.read(account,id!);const result=evaluate(workspace.data,body);productEvent(account.id,"console_evaluation_run",{workspace_id:id});send(res,200,result);return true; }
    if ((method !== "PUT" && !(method === "DELETE" && section === "subjects")) || !["groups","tags","catalog","features","privileges","tiers","variants","organizations","policy","subjects","hosting"].includes(section ?? "")) throw new WorkspaceError("Method not allowed",405);
    if (!Number.isSafeInteger(body.revision) || body.revision < 1) throw new WorkspaceError("Current workspace revision is required");
    const action=section==="hosting"?"hosting:write":section==="subjects"?"contracts:write":section === "groups" || section === "tags" || section === "catalog" || section === "features" || section === "privileges" ? "catalog:write" : section === "organizations" ? "contracts:write" : section === "policy" ? "contracts:write" : "tiers:write";
    const changed=await store.change(account,id!,action,reason(),body.revision,data => {
      let entry=body.entry;
      if(section==='hosting'){
        if(mode!=='saas')throw new WorkspaceError('Cloud service tiers apply only to SaaS deployments');
        const b=object(entry);if(Object.keys(b).some(k=>k!=='tier')||!['pro','enterprise'].includes(b.tier))throw new WorkspaceError('Choose Cloud Pro or Enterprise');
        data.hostedTier=b.tier;
      }
      if(section==='subjects'){
        if(method==='DELETE'){
          const b=object(entry);const subjectId=subjectIdentifier(b.subjectId);const index=data.subjects.findIndex(s=>s.organizationId===b.organizationId&&s.subjectId===subjectId);
          if(index<0)throw new WorkspaceError('User entitlement record not found',404);
          data.subjects.splice(index,1);
        }else{
        requireSubjectEntitlements(data,mode);
        const row=subject(data,entry),index=data.subjects.findIndex(s=>s.organizationId===row.organizationId&&s.subjectId===row.subjectId);
        if(index<0)data.subjects.push(row);else data.subjects[index]=row;
        }
      }
      if((section==="groups"||section==="tags")&&entry&&typeof entry==="object"&&"title" in entry){const {title,parentId,...rest}=entry as Record<string,unknown>;entry={...rest,name:title,...(parentId?{parentId:parentId}:{})};}
      if(section==="catalog"){try{entry=storedDefinition(parsePrivilege(entry));}catch(e){throw new WorkspaceError((e as Error).message,422);}}
      const upsert=<T>(list: T[],value: T,key: (v: T) => string) => { const index=list.findIndex(v => key(v) === key(value));if(index<0)list.push(value);else list[index]=value; };
      if (section === "groups") upsert(data.groups,group(data,entry),v => v.id);
      if(section==="tags")upsert(data.tags,tag(entry),v=>v.id);
      if (section === "features") upsert(data.features,feature(data,entry),v=>v.id);
      if (section === "privileges"||section==="catalog") {
        const def=privilege(data,entry),previous=data.privileges.find(p=>p.key===def.key);
        if(def.envVariable!==previous?.envVariable&&!account.platformAdmin)throw new WorkspaceError("Only a platform administrator can change server environment bindings",403);
        upsert(data.privileges,def,v=>v.key);
      }
      if (section === "tiers") upsert(data.tiers,tier(entry),v => v.id);
      if (section === "variants") upsert(data.variants,variant(data,entry),v => v.id);
      if (section === "organizations") upsert(data.organizations,organization(data,entry),v => v.id);
      if (section === "policy") {
        const b=object(entry); if(Object.keys(b).some(k=>!["past_due","ended"].includes(k)))throw new WorkspaceError("Unknown policy field"); const result={} as Record<"past_due"|"ended",StatusPolicy>;
        for (const status of ["past_due","ended"] as const) {
          const policy=object(b[status]);
          if(Object.keys(policy).some(k=>!["action","variantId"].includes(k)))throw new WorkspaceError("Unknown policy field");
          if (policy.action === "readOnly") result[status]={action:"readOnly"};
          else if (policy.action === "fallback" && data.variants.some(v => v.id === policy.variantId)) result[status]={action:"fallback",variantId:policy.variantId};
          else throw new WorkspaceError("Policy must be read-only or reference an existing variant");
        }
        data.statusPolicy=result;
      }
      validateSubjects(data);
      catalogEnvironment(data,env);
    });
    productEvent(account.id,"workspace_changed",{workspace_id:id,section,method});
    send(res,200,view(changed));return true;
  };
}
