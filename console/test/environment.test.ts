import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {stringify} from 'yaml';
import {environmentOverride} from '../server/environment.ts';
import {emptyData,feature,privilege,tier,variant,organization,resolve,catalogEnvironment} from '../server/workspace/model.ts';
import {buildRuntime,configFromEnv} from '../server/config.ts';
import {startServer} from '../server/main.ts';

test('environment bindings accept only strict booleans, never integers or strings',()=>{
 assert.equal(environmentOverride('access','MCP_INSTALLED','boolean',()=>undefined,{MCP_INSTALLED:'False'}).value,false);
 assert.equal(environmentOverride('access','MCP_INSTALLED','boolean',()=>undefined,{MCP_INSTALLED:'true'}).value,true);
 assert.throws(()=>environmentOverride('access','MCP_INSTALLED','boolean',()=>undefined,{MCP_INSTALLED:'yes'}),/boolean/);
 assert.throws(()=>environmentOverride('access','MCP_INSTALLED','boolean',()=>undefined,{}),/unset/);
 assert.throws(()=>environmentOverride('access','${MCP_INSTALLED}','boolean',()=>undefined,{}),/uppercase/);
 for(const type of ['integer','string','enum'] as const)assert.throws(()=>environmentOverride('value','SETTING',type,()=>undefined,{SETTING:'1'}),/boolean privileges only/);
});

test('workspace environment can veto but never grant access; frozen and hidden defaults still evaluate',()=>{
 const data=emptyData();data.features.push(feature(data,{id:'mcp',name:'MCP'}),feature(data,{id:'internal',name:'Internal',hidden:true}));
 data.privileges.push(privilege(data,{featureId:'mcp',key:'mcp_enabled',name:'MCP',type:'boolean',default:false,envVariable:'MCP_INSTALLED'}),privilege(data,{featureId:'mcp',key:'frozen_limit',name:'Fixed',type:'integer',default:3,frozen:true}),privilege(data,{featureId:'internal',key:'internal_enabled',name:'Internal',type:'boolean',default:true}));
 data.tiers.push(tier({id:'business',name:'Business',rank:1}));data.variants.push(variant(data,{id:'business',name:'Business',tierId:'business',kind:'standard',values:{mcp_enabled:true,frozen_limit:100}}));data.organizations.push(organization(data,{id:'acme',name:'Acme',variantId:'business',terms:{mcp_enabled:true,frozen_limit:200}}));
 const off=catalogEnvironment(data,{MCP_INSTALLED:'False'}),on=catalogEnvironment(data,{MCP_INSTALLED:'true'});
 assert.equal(resolve(data,'acme','mcp_enabled',new Date(),off).value,false);assert.equal(resolve(data,'acme','mcp_enabled',new Date(),on).value,true);
 data.organizations[0]!.terms.mcp_enabled=false;assert.equal(resolve(data,'acme','mcp_enabled',new Date(),on).value,false);
 assert.equal(resolve(data,'acme','frozen_limit',new Date(),off).value,3);assert.equal(resolve(data,'acme','internal_enabled',new Date(),off).value,true);assert.equal(data.organizations[0]!.terms.frozen_limit,200);
 assert.throws(()=>privilege(data,{featureId:'mcp',key:'bound_number',name:'Number',type:'integer',default:5,envVariable:'NUMBER'}),/boolean privileges only/);
 assert.throws(()=>privilege(data,{featureId:'mcp',key:'bound_text',name:'Text',type:'string',default:'read',envVariable:'MODE'}),/boolean privileges only/);
 assert.throws(()=>privilege(data,{featureId:'mcp',key:'missing_default',name:'Missing',type:'boolean',envVariable:'MCP_INSTALLED'}),/Catalog default/);
 // Freezing a boolean chooses its default first; the environment still cannot turn it on.
 data.privileges[0]!.frozen=true;assert.equal(resolve(data,'acme','mcp_enabled',new Date(),on).value,false);
});

test('self-hosted YAML Catalog applies boolean AND over OEREP while frozen and hidden values remain typed',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'oe-environment-')),path=join(dir,'catalog.yaml');
 const source={features:[{code:'mcp',name:'MCP',gate:'mcp_enabled',privileges:[{key:'mcp_enabled',valueType:'boolean',default:false,envVariable:'MCP_INSTALLED'},{key:'fixed_limit',valueType:'integer',default:2,frozen:true}]},{code:'internal',name:'Internal',hidden:true,privileges:[{key:'internal_enabled',valueType:'boolean',default:true}]}]};
 await writeFile(path,stringify(source));const env={OE_CATALOG:path,MCP_INSTALLED:'False',PORT:'0'};
 let running:Awaited<ReturnType<typeof startServer>>|undefined;
 try{
  const rt=await buildRuntime(configFromEnv(env));try{
   const meta={actor:'test',reason:'fixture'};await rt.client.admin.upsertPlan({id:'business',name:'Business'},meta);await rt.client.admin.setPlanValue('business','mcp_enabled',true,meta);await rt.client.admin.setPlanValue('business','fixed_limit',200,meta);await rt.client.admin.assignPlan('acme','business',meta);
   assert.equal(await rt.client.isEnabled('mcp',{organizationId:'acme'}),false);assert.equal((await rt.client.getDetails('fixed_limit',{organizationId:'acme'})).value,2);
  }finally{await rt.close();}
  running=await startServer(configFromEnv({...env,MCP_INSTALLED:'true'}));
  for(const [key,value] of [['mcp_enabled',false],['fixed_limit',2],['internal_enabled',true]] as const){const response:Response=await fetch(running.url+'/oerep/v1/resolve/'+key,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({context:{organizationId:'basic_customer'}})});assert.equal(response.status,200);assert.equal((await response.json()).value,value);}
  await assert.rejects(buildRuntime(configFromEnv({...env,MCP_INSTALLED:'nope'})),/must be a boolean/);
  source.features[0]!.privileges[0]!.valueType='integer';await writeFile(path,stringify(source));await assert.rejects(buildRuntime(configFromEnv(env)));
 }finally{await running?.close();await rm(dir,{recursive:true,force:true});}
});
