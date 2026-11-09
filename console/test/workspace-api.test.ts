import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:net";
import { randomBytes } from "node:crypto";
import pg from "pg";
import { startDevIssuer } from "../dev/issuer.ts";
import { startWorkspaceServer } from "../server/workspace/main.ts";
import { authConfig } from "../server/workspace/auth.ts";

async function port(){const server=createServer();await new Promise<void>(ok=>server.listen(0,"127.0.0.1",ok));const value=(server.address() as {port:number}).port;await new Promise<void>(ok=>server.close(()=>ok()));return value;}

test("workspace HTTP authorization, RLS, invitations, keys, optimistic locking and typed inheritance",{skip:!process.env.OE_PG_DSN},async()=>{
  const admin=new pg.Client({connectionString:process.env.OE_PG_DSN});await admin.connect();
  const name="oe_ws_"+randomBytes(8).toString("hex"),password=randomBytes(24).toString("hex");
  let issuer:Awaited<ReturnType<typeof startDevIssuer>>|undefined,running:Awaited<ReturnType<typeof startWorkspaceServer>>|undefined;
  let role=false,database=false;
  try{
    await admin.query(`CREATE ROLE ${name} LOGIN PASSWORD '${password}'`);role=true;
    await admin.query(`CREATE DATABASE ${name} OWNER ${name}`);database=true;
    const dbUrl=`postgresql://${name}:${password}@${admin.host}:${admin.port}/${name}`;
    const appPort=await port(),issuerPort=await port(),origin=`http://localhost:${appPort}`;
    const runtimeEnv={MCP_INSTALLED:"False",INVALID_BOOLEAN:"nope"};
    issuer=await startDevIssuer(issuerPort,origin);
    running=await startWorkspaceServer({databaseUrl:dbUrl,port:appPort,env:runtimeEnv,auth:authConfig({OE_APP_URL:origin,OE_OIDC_ISSUER:issuer.url,OE_OIDC_LOCAL_HTTP:"true",OE_PLATFORM_ADMIN_SUBJECT:"local-admin"})});
    const store=running.store;
    const owner=await store.account("test","owner","owner@example.test",false),other=await store.account("test","other","other@example.test",false),user=await store.account("test","user","user@example.test",false),manager=await store.account("test","manager","manager@example.test",false),platform=await store.account("test","platform","platform@example.test",true),invited=await store.account("test","invited","invited@example.test",false);
    async function login(account:typeof owner){const secret=await store.createSession(account),session=(await store.session(secret))!;return{cookie:`oe_session=${secret}`,"x-oe-csrf":session.csrf,origin};}
    const a=await login(owner),b=await login(other),u=await login(user),m=await login(manager),p=await login(platform),i=await login(invited);
    async function call(path:string,headers:Record<string,string>={},body?:unknown,method=body?"POST":"GET"){
      const response=await fetch(origin+path,{method,headers:{"content-type":"application/json",...headers},...(body===undefined?{}:{body:JSON.stringify(body)})});
      return{status:response.status,data:response.status===204?undefined:await response.json()};
    }
    const malformed=await fetch(origin+"/app/%E0%A4%A");assert.equal(malformed.status,400);
    assert.equal((await call("/api/workspaces")).status,401);
    assert.equal((await call("/api/workspaces",{authorization:"Bearer old-admin"})).status,401);
    assert.equal((await call("/api/workspaces",{cookie:a.cookie},{name:"Missing CSRF",reason:"test"})).status,403);
    const wa=await call("/api/workspaces",a,{name:"A",reason:"create"});assert.equal(wa.status,201);
    const wa2=await call("/api/workspaces",a,{name:"A second",reason:"create"});assert.equal(wa2.status,201);
    const wb=await call("/api/workspaces",b,{name:"B",reason:"create"});assert.equal(wb.status,201);
    const path=`/api/workspaces/${wa.data.id}`;let revision=1;
    assert.equal((await call("/api/workspaces",a)).data.length,2);
    assert.equal((await call("/api/workspaces",b)).data.length,1);
    assert.equal((await call("/api/workspaces",p)).data.length,3);
    assert.equal((await call(path,b)).status,404);
    assert.equal((await call(path+"/groups",b,{revision:1,reason:"try another workspace",entry:{id:"bad",name:"Bad"}},"PUT")).status,404);
    assert.equal((await call(path,p)).status,200);
    await store.setMember(owner,wa.data.id,user.id,"User","fixture");await store.setMember(owner,wa.data.id,manager.id,"Manager","fixture");
    assert.equal((await call(path,u)).status,200);
    assert.equal((await call(path+"/groups",u,{revision:1,reason:"try write",entry:{id:"bad",name:"Bad"}},"PUT")).status,403);
    assert.equal((await call(path+"/groups",m,{revision:1,reason:"try write",entry:{id:"bad",name:"Bad"}},"PUT")).status,403);
    async function put(section:string,entry:unknown,expected=200){const result=await call(path+"/"+section,a,{revision,reason:"configure",entry},"PUT");assert.equal(result.status,expected,JSON.stringify(result.data));if(result.status===200)revision=result.data.revision;return result;}
    await put("groups",{id:"product",name:"Product",description:"Product capabilities"});
    await put("groups",{id:"exports",name:"Exports",parentId:"product"});
    await put("groups",{id:"product",name:"Product",parentId:"exports"},400);
    await put("features",{id:"exports",name:"Exports",groupId:"exports"});
    await put("privileges",{key:"exports.max",name:"Exports",featureId:"exports",type:"integer",default:5},400);
    await put("privileges",{key:"max_exports",name:"Maximum exports",featureId:"exports",type:"integer",minimum:0,unlimited:true,default:5});
    await put("privileges",{key:"retention",name:"Retention",featureId:"exports",type:"string",enum:["30d","365d"]});
    await put("tiers",{id:"pro",name:"Pro",rank:1,gracePeriodDays:7});
    await put("variants",{id:"pro",name:"Pro",tierId:"pro",kind:"standard",values:{}},422);
    await put("variants",{id:"pro",name:"Pro",tierId:"pro",kind:"standard",values:{retention:"30d"}});
    await put("variants",{id:"pro_grace",name:"Pro grace",tierId:"pro",kind:"grace",values:{retention:"30d",max_exports:1}});
    await put("organizations",{id:"acme",name:"Acme",variantId:"pro",terms:{max_exports:25}});
    assert.equal((await call(path+"/evaluate",u,{organizationId:"acme",privilege:"max_exports"})).data.value,25);
    const alice={organizationId:"acme",subjectId:"external|alice",name:"Alice",terms:{max_exports:30},grants:{max_exports:5}};
    await put("subjects",alice);
    let otherRevision=wb.data.revision;
    for(const [section,entry] of [["privileges",{key:"max_exports",name:"Exports",type:"integer",default:1}],["tiers",{id:"pro",name:"Pro",rank:1}],["variants",{id:"pro",name:"Pro",tierId:"pro",kind:"standard"}],["organizations",{id:"acme",name:"Other Acme",variantId:"pro",terms:{max_exports:999}}],["subjects",{...alice,terms:{max_exports:777},grants:{}}]]){
      const configured=await call(`/api/workspaces/${wb.data.id}/${section}`,b,{entry,revision:otherRevision,reason:"Same identifiers in another Workspace"},"PUT");assert.equal(configured.status,200);otherRevision=configured.data.revision;
    }
    assert.equal((await call(`/api/workspaces/${wb.data.id}/evaluate`,b,{organizationId:"acme",subjectId:alice.subjectId,privilege:"max_exports"})).data.value,777);

    assert.equal((await call(path+"/evaluate",u,{organizationId:"acme",privilege:"max_exports",subjectId:alice.subjectId})).data.value,35);
    assert.equal((await call(path+"/evaluate",u,{organizationId:"acme",privilege:"max_exports",subjectId:"bob"})).data.value,25);
    assert.equal((await call(path+"/evaluate",u,{organizationId:"acme",privilege:"max_exports",subjectId:null})).status,400);
    assert.equal((await call(path+"/subjects",u,{revision,reason:"unauthorized",entry:alice},"PUT")).status,403);
    assert.equal((await call(path+"/subjects",b,{revision,reason:"other workspace",entry:alice},"PUT")).status,404);
    await put("subjects",{...alice,terms:{max_exports:-5}},422);

    await put("organizations",{id:"acme",name:"Acme",variantId:"pro",terms:{max_exports:-5}},422);
    const stale=await call(path+"/groups",a,{revision:1,reason:"stale",entry:{id:"stale",name:"Stale"}},"PUT");assert.equal(stale.status,409);
    assert.equal((await call(path+"/keys",u)).status,403);
    const key=await call(path+"/keys",a,{name:"Backend",scope:"evaluate",reason:"test"});assert.equal(key.status,201);
    const secret=key.data.secret;
    assert.equal((await call("/api/evaluate",{authorization:`Bearer ${secret}`},{organizationId:"acme",privilege:"max_exports",subjectId:alice.subjectId})).data.value,35);
    const keyList=await call(path+"/keys",a);assert.equal(JSON.stringify(keyList.data).includes(secret),false);
    assert.equal((await call("/api/evaluate",{authorization:`Bearer ${secret}`},{organizationId:"acme",privilege:"max_exports"})).data.value,25);
    assert.equal((await call("/api/evaluate",{authorization:`Bearer ${secret}`},{organizationId:"only_in_b",privilege:"max_exports",workspaceId:wb.data.id})).status,404);
    assert.equal((await call(path,{authorization:`Bearer ${secret}`})).status,401);
    const historyBefore=(await call(path+"/audit",a)).data.length;
    assert.equal((await call(path+"/keys/not-a-uuid",a,{reason:"revoke"},"DELETE")).status,404);
    assert.equal((await call(path+"/keys/00000000-0000-0000-0000-000000000000",a,{reason:"revoke"},"DELETE")).status,404);
    assert.equal((await call(path+"/audit",a)).data.length,historyBefore);
    await call(path+"/keys/"+key.data.id,a,{reason:"revoke"},"DELETE");
    assert.equal((await call("/api/evaluate",{authorization:`Bearer ${secret}`},{organizationId:"acme",privilege:"max_exports"})).status,401);
    const invite=await call(path+"/invitations",m,{email:"invited@example.test",role:"User",reason:"invite"});assert.equal(invite.status,201);
    assert.equal((await call(path+"/invitations",m,{email:"invited@example.test",role:"Owner",reason:"escalate"})).status,403);
    assert.equal((await call("/api/invitations/accept",b,{token:invite.data.token})).status,403);
    assert.equal((await call("/api/invitations/accept",i,{token:invite.data.token})).status,200);
    assert.equal((await call("/api/invitations/accept",i,{token:invite.data.token})).status,403);
    assert.equal((await call("/api/workspaces",i)).data.length,1);
    const repeatInvite=await call(path+"/invitations",a,{email:"invited@example.test",role:"Manager",reason:"existing member"});
    const existingMember=await call("/api/invitations/accept",i,{token:repeatInvite.data.token});
    assert.equal(existingMember.data.alreadyMember,true);assert.equal(existingMember.data.role,"User");
    assert.equal((await call(path+"/members",m,{accountId:invited.id,role:null,reason:"remove member"},"PUT")).status,200);
    assert.equal((await call(path,i)).status,404);
    assert.equal((await call(path+"/members",a,{accountId:owner.id,role:"User",reason:"remove last owner"},"PUT")).status,409);
    assert.equal((await call(path+"/members",m,{accountId:owner.id,role:"User",reason:"demote owner"},"PUT")).status,403);
    const direct=await store.pool.connect();try{
      assert.equal((await direct.query("SELECT * FROM oe_cp_state")).rows.length,0);
      await direct.query("BEGIN");await direct.query("SELECT set_config('oe.workspace_id',$1,true)",[wa.data.id]);
      assert.equal((await direct.query("SELECT * FROM oe_cp_state WHERE workspace_id=$1",[wb.data.id])).rows.length,0);
      await assert.rejects(direct.query("UPDATE oe_cp_state SET workspace_id=$1 WHERE workspace_id=$2",[wb.data.id,wa.data.id]),/row-level security/);
      await direct.query("ROLLBACK");
      await put("tags",{id:"enterprise",title:"Enterprise"});await put("tags",{id:"integration",title:"Integration"});
    const canonical={key:"canonical_limit",title:"Canonical limit",description:"A grouped and tagged privilege",type:"integer",default:2,minimum:0,unlimited:false,visibility:"read_only",group_id:"product",tags:["enterprise","integration"]};
    await put("catalog",canonical);
    await put("catalog",{...canonical,key:"bad_environment",env_override:"MCP_INSTALLED"},422);
    await put("catalog",{...canonical,key:"bad_tags",tags:["missing"]},400);
    await put("catalog",{...canonical,key:"many_groups",group_ids:["product","exports"]},422);
    const publicCatalog=(await call(path+"/catalog",a)).data;assert.deepEqual(publicCatalog.privileges.find((p:any)=>p.key==="canonical_limit"),canonical);assert.equal(publicCatalog.groups.find((g:any)=>g.id==="product").title,"Product");assert.equal(publicCatalog.tags.length,2);
    const oldOrg=(await call(path,a)).data.data.organizations[0];await put("organizations",{...oldOrg,terms:{...oldOrg.terms,canonical_limit:200}});assert.equal((await call(path+"/evaluate",a,{organizationId:"acme",privilege:"canonical_limit"})).data.value,2);
  }finally{direct.release();}
    const parallel=await Promise.all(Array.from({length:12},(_,n)=>store.read(n%2?owner:other,n%2?wa.data.id:wb.data.id)));
    for(let n=0;n<parallel.length;n++)assert.equal(parallel[n]!.id,n%2?wa.data.id:wb.data.id);
    const history=await call(path+"/audit",a);assert.ok(history.data.some((e:any)=>e.actor===owner.id&&e.action==="catalog:write"));
    await call("/auth/logout",u,{},"POST");assert.equal((await call(path,u)).status,401);
    // Restart the service with the same database; workspace and negotiated terms persist.
    await running.close();running=await startWorkspaceServer({databaseUrl:dbUrl,port:appPort,env:runtimeEnv,auth:authConfig({OE_APP_URL:origin,OE_OIDC_ISSUER:issuer.url,OE_OIDC_LOCAL_HTTP:"true"})});
    assert.equal((await call(path,a)).data.data.organizations[0].terms.max_exports,25);
    const definition={key:"mcp_enabled",name:"MCP",featureId:"exports",type:"boolean",default:true,envVariable:"MCP_INSTALLED"};
    assert.equal((await call(path+"/privileges",a,{entry:definition,revision,reason:"owner cannot bind server env"},"PUT")).status,403);
    const bound=await call(path+"/privileges",p,{entry:definition,revision,reason:"bind boolean"},"PUT");assert.equal(bound.status,200);revision=bound.data.revision;assert.equal(bound.data.environment.mcp_enabled.value,false);
    assert.equal((await call(path+"/evaluate",a,{organizationId:"acme",privilege:"mcp_enabled"})).data.value,false);
    assert.equal((await call(path+"/privileges",p,{entry:{...definition,envVariable:"INVALID_BOOLEAN"},revision,reason:"invalid binding"},"PUT")).status,422);
    const keyForEnv=await call(path+"/keys",p,{name:"Environment evaluation",scope:"evaluate",reason:"test"});assert.equal((await call("/api/evaluate",{authorization:`Bearer ${keyForEnv.data.secret}`},{organizationId:"acme",privilege:"mcp_enabled",environment:{}})).data.value,false);
    assert.equal((await call(path,a)).data.data.subjects[0].subjectId,alice.subjectId);
    await running.close();running=await startWorkspaceServer({databaseUrl:dbUrl,port:appPort,env:{...runtimeEnv,OE_DEPLOYMENT_MODE:"saas"},auth:authConfig({OE_APP_URL:origin,OE_OIDC_ISSUER:issuer.url,OE_OIDC_LOCAL_HTTP:"true"})});
    assert.equal((await call(path,a)).data.hosting.subjectEntitlements,false);
    await put("subjects",alice,403);
    assert.equal((await call(path+"/evaluate",a,{organizationId:"acme",privilege:"max_exports",subjectId:alice.subjectId})).status,403);
    assert.equal((await call("/api/evaluate",{authorization:`Bearer ${keyForEnv.data.secret}`},{organizationId:"acme",privilege:"max_exports",subjectId:alice.subjectId})).status,403);
    assert.equal((await call(path+"/evaluate",a,{organizationId:"acme",privilege:"max_exports"})).data.value,25);
    await put("hosting",{tier:"enterprise"},403);
    const upgrade=await call(path+"/hosting",p,{entry:{tier:"enterprise"},revision,reason:"Enable Enterprise user scope"},"PUT");assert.equal(upgrade.status,200);revision=upgrade.data.revision;
    assert.equal(upgrade.data.hosting.subjectEntitlements,true);
    assert.equal((await call("/api/evaluate",{authorization:`Bearer ${keyForEnv.data.secret}`},{organizationId:"acme",privilege:"max_exports",subjectId:alice.subjectId})).data.value,35);
    const downgrade=await call(path+"/hosting",p,{entry:{tier:"pro"},revision,reason:"Downgrade retains data"},"PUT");assert.equal(downgrade.status,200);revision=downgrade.data.revision;
    assert.equal((await call(path,a)).data.data.subjects.length,1);
    const removed=await call(path+"/subjects",a,{entry:{organizationId:"acme",subjectId:alice.subjectId},revision,reason:"Remove personal exception"},"DELETE");assert.equal(removed.status,200);revision=removed.data.revision;
    assert.equal((await call(path,a)).data.data.subjects.length,0);
    assert.ok((await call(path+"/audit",a)).data.some((e:any)=>e.actor===platform.id&&e.action==="hosting:write"));

    assert.equal((await call(path+"/privileges",p,{entry:{...definition,key:"bound_number",type:"integer",default:5},revision,reason:"unsupported integer"},"PUT")).status,400);
    const {envVariable:_env,...unbound}=definition;assert.equal((await call(path+"/privileges",a,{entry:unbound,revision,reason:"unlink env"},"PUT")).status,403);
  }finally{
    await running?.close();await issuer?.close();
    if(database)await admin.query(`DROP DATABASE ${name} WITH (FORCE)`);if(role)await admin.query(`DROP ROLE ${name}`);await admin.end();
  }
});
