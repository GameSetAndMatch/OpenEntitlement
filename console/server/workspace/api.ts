import type { IncomingMessage, ServerResponse } from "node:http";
import { readJson, send } from "../http.ts";
import { Authentication } from "./auth.ts";
import { WorkspaceStore } from "./store.ts";
import { WorkspaceError, object, text, group, feature, privilege, tier, variant, organization, resolve, type StatusPolicy } from "./model.ts";

export function workspaceApi(auth: Authentication,store: WorkspaceStore) {
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
      const now=b.now === undefined ? new Date() : new Date(b.now);
      if (!Number.isFinite(now.getTime())) throw new WorkspaceError("Invalid evaluation time");
      send(res,200,resolve(await store.keyData(key.workspace_id),text(b.organizationId,"Organization"),text(b.privilege,"Privilege"),now));return true;
    }
    const session=await auth.session(req),account=session.account;
    if (method !== "GET") auth.csrf(req,session);
    if (path === "/auth/logout" && method === "POST") { await auth.logout(req,res,session);return true; }
    if (path === "/api/session" && method === "GET") { send(res,200,{account,csrf:session.csrf});return true; }
    if (path === "/api/workspaces" && method === "GET") { send(res,200,await store.list(account));return true; }
    const body=method === "GET" ? {} : object(await readJson(req));
    const reason=() => text(body.reason,"Reason",2000);
    if (path === "/api/workspaces" && method === "POST") { send(res,201,await store.create(account,text(body.name,"Workspace name"),reason()));return true; }
    if (path === "/api/invitations/accept" && method === "POST") { send(res,200,await store.acceptInvite(account,text(body.token,"Invitation token")));return true; }
    const match=/^\/api\/workspaces\/([^/]+)(?:\/(groups|features|privileges|tiers|variants|organizations|policy|audit|members|invitations|keys|evaluate))?(?:\/([^/]+))?$/.exec(path);
    if (!match) throw new WorkspaceError("Endpoint not found",404);
    const [,id,section,target]=match;
    if (!section && method === "GET") { send(res,200,await store.read(account,id!));return true; }
    if (section === "audit" && method === "GET") { send(res,200,await store.history(account,id!));return true; }
    if (section === "invitations" && method === "POST") {
      if (!["Owner","Manager","User"].includes(body.role))throw new WorkspaceError("Invalid role");
      const email=text(body.email,"Email");if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw new WorkspaceError("Enter a valid email address");
      send(res,201,await store.invite(account,id!,email,body.role,reason()));return true;
    }
    if (section === "members" && method === "GET") { send(res,200,await store.members(account,id!));return true; }
    if (section === "members" && method === "PUT") {
      if (body.role !== null && !["Owner","Manager","User"].includes(body.role)) throw new WorkspaceError("Invalid role");
      const accountId=text(body.accountId,"Account ID");
      if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(accountId)) throw new WorkspaceError("Invalid Account ID");
      await store.setMember(account,id!,accountId,body.role,reason());send(res,200,{});return true;
    }
    if (section === "keys" && method === "GET") { send(res,200,await store.keys(account,id!));return true; }
    if (section === "keys" && method === "POST") {
      if (body.scope !== "evaluate") throw new WorkspaceError("Invalid key scope");
      send(res,201,await store.createKey(account,id!,text(body.name,"Key name"),body.scope,reason()));return true;
    }
    if (section === "keys" && target && method === "DELETE") { if(!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(target))throw new WorkspaceError("API key not found",404); await store.revokeKey(account,id!,target,reason());send(res,200,{});return true; }
    if (section === "evaluate" && method === "POST") { const workspace=await store.read(account,id!);send(res,200,resolve(workspace.data,text(body.organizationId,"Organization"),text(body.privilege,"Privilege")));return true; }
    if (method !== "PUT" || !["groups","features","privileges","tiers","variants","organizations","policy"].includes(section ?? "")) throw new WorkspaceError("Method not allowed",405);
    if (!Number.isSafeInteger(body.revision) || body.revision < 1) throw new WorkspaceError("Current workspace revision is required");
    const action=section === "groups" || section === "features" || section === "privileges" ? "catalog:write" : section === "organizations" ? "contracts:write" : section === "policy" ? "contracts:write" : "tiers:write";
    const changed=await store.change(account,id!,action,reason(),body.revision,data => {
      const entry=body.entry;
      const upsert=<T>(list: T[],value: T,key: (v: T) => string) => { const index=list.findIndex(v => key(v) === key(value));if(index<0)list.push(value);else list[index]=value; };
      if (section === "groups") upsert(data.groups,group(data,entry),v => v.id);
      if (section === "features") upsert(data.features,feature(data,entry),v=>v.id);
      if (section === "privileges") upsert(data.privileges,privilege(data,entry),v => v.key);
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
    });
    send(res,200,changed);return true;
  };
}
