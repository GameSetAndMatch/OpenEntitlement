import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:net";
import { randomBytes } from "node:crypto";
import pg from "pg";
import { startDevIssuer } from "../dev/issuer.ts";
import { startWorkspaceServer } from "../server/workspace/main.ts";
import { authConfig } from "../server/workspace/auth.ts";

async function port(){const server=createServer();await new Promise<void>(ok=>server.listen(0,"127.0.0.1",ok));const value=(server.address() as {port:number}).port;await new Promise<void>(ok=>server.close(()=>ok()));return value;}

// OPE-54 over HTTP and PostgreSQL: a Privilege change, the variant values it needs and the values Read-only removes save as one
// audited change, or not at all. Read-only removes stored values only when the request asks (removeOwnValues) on the catalog route.
test("Privilege changes over HTTP: Read-only cleanup, legacy route, atomic rollback and audit",{skip:!process.env.OE_PG_DSN},async()=>{
  const admin=new pg.Client({connectionString:process.env.OE_PG_DSN});await admin.connect();
  const name="oe_cat_"+randomBytes(8).toString("hex"),password=randomBytes(24).toString("hex");
  let issuer:Awaited<ReturnType<typeof startDevIssuer>>|undefined,running:Awaited<ReturnType<typeof startWorkspaceServer>>|undefined,auditDb:pg.Client|undefined;
  let role=false,database=false;
  try{
    await admin.query(`CREATE ROLE ${name} LOGIN PASSWORD '${password}'`);role=true;
    await admin.query(`CREATE DATABASE ${name} OWNER ${name}`);database=true;
    const dbUrl=`postgresql://${name}:${password}@${admin.host}:${admin.port}/${name}`;
    const appPort=await port(),issuerPort=await port(),origin=`http://localhost:${appPort}`;
    issuer=await startDevIssuer(issuerPort,origin);
    running=await startWorkspaceServer({databaseUrl:dbUrl,port:appPort,env:{MCP_INSTALLED:"true"},auth:authConfig({OE_APP_URL:origin,OE_OIDC_ISSUER:issuer.url,OE_OIDC_LOCAL_HTTP:"true",OE_PLATFORM_ADMIN_SUBJECT:"local-admin"})});
    const store=running.store;
    const owner=await store.account("test","owner","owner@example.test",false),user=await store.account("test","user","user@example.test",false),platform=await store.account("test","platform","platform@example.test",true);
    async function login(account:typeof owner){const secret=await store.createSession(account),session=(await store.session(secret))!;return{cookie:`oe_session=${secret}`,"x-oe-csrf":session.csrf,origin};}
    const a=await login(owner),u=await login(user),p=await login(platform);
    async function call(path:string,headers:Record<string,string>,body?:unknown,method=body?"POST":"GET"){
      const response=await fetch(origin+path,{method,headers:{"content-type":"application/json",...headers},...(body===undefined?{}:{body:JSON.stringify(body)})});
      return{status:response.status,data:await response.json()};
    }
    const created=await call("/api/workspaces",a,{name:"Catalog changes",reason:"create"});assert.equal(created.status,201);
    const id=created.data.id,path=`/api/workspaces/${id}`;
    await store.setMember(owner,id,user.id,"User","fixture");
    // The audit table is read as a superuser: row-level security limits the service role to one workspace per transaction.
    const auditUrl=new URL(process.env.OE_PG_DSN!);auditUrl.pathname="/"+name;auditDb=new pg.Client({connectionString:auditUrl.toString()});await auditDb.connect();
    const audits=async()=>(await auditDb!.query("SELECT actor,action,reason,before_data,after_data FROM oe_cp_audit WHERE workspace_id=$1 ORDER BY at",[id])).rows;
    const read=async()=>(await call(path,a)).data as {revision:number;data:any};
    let revision=(await read()).revision;
    async function put(section:string,body:Record<string,unknown>,headers=a){const result=await call(path+"/"+section,headers,{revision,...body},"PUT");if(result.status===200)revision=result.data.revision;return result;}
    async function ok(section:string,body:Record<string,unknown>,headers=a){const result=await put(section,body,headers);assert.equal(result.status,200,JSON.stringify(result.data));return result;}
    /** A rejected request leaves the definition, every value, the revision and the audit log exactly as they were. */
    async function rejected(status:number,message:RegExp,request:()=>Promise<{status:number;data:any}>){
      const before=await read(),log=(await audits()).length;
      const result=await request();
      assert.equal(result.status,status,JSON.stringify(result.data));assert.match(JSON.stringify(result.data),message);
      const after=await read();
      assert.deepEqual(after,before,"A rejected change must not alter the workspace or its revision");
      assert.equal((await audits()).length,log,"A rejected change must not be audited");
    }
    const evaluate=async(privilege:string,subjectId?:string)=>(await call(path+"/evaluate",u,{organizationId:"acme",privilege,...(subjectId?{subjectId}:{})})).data.value;
    const holders=(data:any,key:string)=>({pro:data.variants.find((v:any)=>v.id==="pro").values[key],acme:data.organizations.find((o:any)=>o.id==="acme").terms[key],alice:data.subjects.find((s:any)=>s.subjectId==="alice").terms[key],grant:data.subjects.find((s:any)=>s.subjectId==="alice").grants[key]});
    const seats=(visibility:string,extra:Record<string,unknown>={})=>({key:"seats",title:"Seats",type:"integer",default:5,visibility,...extra});

    // Fixture: Seats is set by the Pro variant, Acme's terms and Alice's personal terms; Alice also has a Grant.
    await ok("catalog",{entry:seats("editable"),reason:"fixture"});
    await ok("tiers",{entry:{id:"pro",name:"Pro",rank:1},reason:"fixture"});
    await ok("variants",{entry:{id:"pro",name:"Pro",tierId:"pro",kind:"standard",values:{seats:10}},reason:"fixture"});
    await ok("variants",{entry:{id:"pro_trial",name:"Pro trial",tierId:"pro",kind:"trial",values:{}},reason:"fixture"});
    await ok("organizations",{entry:{id:"acme",name:"Acme",variantId:"pro",terms:{seats:25}},reason:"fixture"});
    await ok("subjects",{entry:{organizationId:"acme",subjectId:"alice",name:"Alice",terms:{seats:30},grants:{seats:2}},reason:"fixture"});
    const fixture={pro:10,acme:25,alice:30,grant:2};
    assert.equal(await evaluate("seats"),25);assert.equal(await evaluate("seats","alice"),32);

    // Legacy route: Read-only never removes values. They stay stored without effect, and Editable brings them back.
    await ok("privileges",{entry:{key:"seats",name:"Seats",type:"integer",default:5,frozen:true},reason:"legacy freeze"});
    assert.deepEqual(holders((await read()).data,"seats"),fixture);
    assert.equal(await evaluate("seats"),5);assert.equal(await evaluate("seats","alice"),5);
    await rejected(400,/catalog route/,()=>put("privileges",{entry:{key:"seats",name:"Seats",type:"integer",default:5,frozen:true},removeOwnValues:true,reason:"legacy cleanup"}));
    // Editing an already Read-only Privilege keeps them too, and cannot ask to remove them.
    await ok("catalog",{entry:seats("read_only",{title:"Seats (locked)"}),reason:"rename"});
    assert.deepEqual(holders((await read()).data,"seats"),fixture);
    await rejected(409,/only when an existing Privilege becomes Read-only/,()=>put("catalog",{entry:seats("read_only"),removeOwnValues:true,reason:"late cleanup"}));
    await ok("catalog",{entry:seats("editable"),reason:"restore"});
    assert.deepEqual(holders((await read()).data,"seats"),fixture);assert.equal(await evaluate("seats"),25);assert.equal(await evaluate("seats","alice"),32);

    // Catalog route without removeOwnValues behaves like the legacy route: nothing is removed.
    await ok("catalog",{entry:seats("read_only"),reason:"freeze, keep values"});
    assert.deepEqual(holders((await read()).data,"seats"),fixture);
    await ok("catalog",{entry:seats("editable"),reason:"restore"});

    // Removing Organization or personal terms changes contract terms: it needs a reason. A stale revision changes nothing either.
    await rejected(400,/reason for changing contract terms/,()=>put("catalog",{entry:seats("read_only"),removeOwnValues:true}));
    await rejected(409,/Workspace changed elsewhere/,()=>call(path+"/catalog",a,{revision:revision-1,entry:seats("read_only"),removeOwnValues:true,reason:"stale"},"PUT"));
    await rejected(403,/./,()=>put("catalog",{entry:seats("read_only"),removeOwnValues:true,reason:"not allowed"},u));
    await rejected(400,/removeOwnValues must be true or false/,()=>put("catalog",{entry:seats("read_only"),removeOwnValues:"yes",reason:"typed"}));

    // The confirmed change: one revision, one audit entry with the actual actor, the reason and the full before and after.
    const log=(await audits()).length,from=revision;
    await ok("catalog",{entry:seats("read_only"),removeOwnValues:true,reason:"Seats are fixed for everyone"});
    assert.equal(revision,from+1);
    const after=(await read()).data;
    assert.deepEqual(holders(after,"seats"),{pro:undefined,acme:undefined,alice:undefined,grant:2},"Grants are allowances and stay");
    assert.equal(await evaluate("seats"),5);assert.equal(await evaluate("seats","alice"),5);
    const entries=await audits();assert.equal(entries.length,log+1);
    const entry=entries.at(-1);
    assert.equal(entry.actor,owner.id);assert.equal(entry.action,"catalog:write");assert.equal(entry.reason,"Seats are fixed for everyone");
    assert.deepEqual(holders(entry.before_data,"seats"),fixture);
    assert.deepEqual(holders(entry.after_data,"seats"),{pro:undefined,acme:undefined,alice:undefined,grant:2});
    assert.equal(entry.before_data.privileges.find((x:any)=>x.key==="seats").frozen,false);
    assert.equal(entry.after_data.privileges.find((x:any)=>x.key==="seats").frozen,true);
    assert.deepEqual(entry.after_data,after);
    // Returning to Editable does not bring removed values back: the Catalog default applies until someone sets them again.
    await ok("catalog",{entry:seats("editable"),reason:"restore"});
    assert.deepEqual(holders((await read()).data,"seats"),{pro:undefined,acme:undefined,alice:undefined,grant:2});
    assert.equal(await evaluate("seats"),5);assert.equal(await evaluate("seats","alice"),7);

    // Only variant values: removing them changes no contract terms, so no reason is needed.
    await ok("catalog",{entry:{key:"reports",title:"Reports",type:"integer",default:1,visibility:"editable"},reason:"fixture"});
    await ok("variants",{entry:{id:"pro",name:"Pro",tierId:"pro",kind:"standard",values:{reports:4}},reason:"fixture"});
    await ok("catalog",{entry:{key:"reports",title:"Reports",type:"integer",default:1,visibility:"read_only"},removeOwnValues:true});
    assert.equal((await read()).data.variants.find((v:any)=>v.id==="pro").values.reports,undefined);
    await rejected(409,/No record sets its own value/,()=>put("catalog",{entry:{key:"seats",title:"Seats",type:"integer",default:5,visibility:"read_only"},removeOwnValues:true,reason:"nothing to remove"}));

    // Requiring a value: the definition and every existing variant's value save together, or nothing does.
    const exports=(extra:Record<string,unknown>={})=>({entry:{key:"exports",title:"Exports",type:"integer",visibility:"editable"},reason:"exports",...extra});
    await rejected(409,/Set exports in every existing variant/,()=>put("catalog",exports()));
    await rejected(409,/Set exports in every existing variant/,()=>put("catalog",exports({variantValues:{pro:3}})));
    await rejected(409,/0 or greater/,()=>put("catalog",exports({variantValues:{pro:3,pro_trial:-1}})));
    await rejected(422,/Variant not found: missing/,()=>put("catalog",exports({variantValues:{pro:3,pro_trial:1,missing:1}})));
    await rejected(400,/catalog route/,()=>put("privileges",{entry:{key:"exports",name:"Exports",type:"integer"},variantValues:{pro:3,pro_trial:1},reason:"legacy"}));
    await rejected(403,/./,()=>put("catalog",exports({variantValues:{pro:3,pro_trial:1}}),u));
    await rejected(409,/Workspace changed elsewhere/,()=>call(path+"/catalog",a,{revision:revision-1,...exports({variantValues:{pro:3,pro_trial:1}})},"PUT"));
    const beforeExports=(await audits()).length;
    await ok("catalog",exports({variantValues:{pro:3,pro_trial:1}}));
    assert.deepEqual((await read()).data.variants.map((v:any)=>v.values.exports),[3,1]);
    assert.equal((await audits()).length,beforeExports+1,"One change, one audit entry");

    // Only a platform administrator binds a Privilege to the server environment. A refused binding also rolls back
    // the values the same request removed, because the check runs after them inside the transaction.
    await ok("catalog",{entry:{key:"beta",title:"Beta",type:"boolean",default:false,visibility:"editable"},reason:"fixture"});
    await ok("variants",{entry:{id:"pro",name:"Pro",tierId:"pro",kind:"standard",values:{beta:true,exports:3}},reason:"fixture"});
    const bound={entry:{key:"beta",title:"Beta",type:"boolean",default:false,visibility:"read_only",envOverride:"MCP_INSTALLED"},removeOwnValues:true,reason:"bind"};
    await rejected(403,/Only a platform administrator/,()=>put("catalog",bound));
    assert.equal((await read()).data.variants.find((v:any)=>v.id==="pro").values.beta,true);
    await ok("catalog",bound,p);
    const bindingAudit=(await audits()).at(-1);assert.equal(bindingAudit.actor,platform.id);assert.equal(bindingAudit.before_data.variants.find((v:any)=>v.id==="pro").values.beta,true);
    assert.equal((await read()).data.variants.find((v:any)=>v.id==="pro").values.beta,undefined);
  }finally{
    await auditDb?.end();await running?.close();await issuer?.close();
    if(database)await admin.query(`DROP DATABASE ${name} WITH (FORCE)`);if(role)await admin.query(`DROP ROLE ${name}`);await admin.end();
  }
});
