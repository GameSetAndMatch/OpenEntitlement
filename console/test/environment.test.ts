import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {stringify} from 'yaml';
import {environmentOverride} from '../server/environment.ts';
import {emptyData,feature,privilege,tier,variant,organization,resolve,catalogEnvironment,valueError} from '../server/workspace/model.ts';
import {buildRuntime,configFromEnv} from '../server/config.ts';
import {startServer} from '../server/main.ts';

test('environment values parse strictly using Catalog types and constraints',()=>{
 const number={key:'max_exports',name:'Exports',description:'',type:'integer' as const,minimum:0,maximum:10};
 assert.equal(environmentOverride('max_exports','MAX_EXPORTS','integer',v=>valueError(number,v),{MAX_EXPORTS:'7'}).value,7);
 for(const raw of ['-5','11','1.5','NaN','9007199254740992'])assert.throws(()=>environmentOverride('max_exports','MAX_EXPORTS','integer',v=>valueError(number,v),{MAX_EXPORTS:raw}));
 assert.equal(environmentOverride('access','MCP_ENABLED','boolean',()=>undefined,{MCP_ENABLED:'False'}).value,false);
 assert.throws(()=>environmentOverride('access','MCP_ENABLED','boolean',()=>undefined,{MCP_ENABLED:'yes'}),/boolean/);
 assert.throws(()=>environmentOverride('access','MCP_ENABLED','boolean',()=>undefined,{}),/unset/);
 assert.throws(()=>environmentOverride('access','${MCP_ENABLED}','boolean',()=>undefined,{}),/uppercase/);
 assert.equal(environmentOverride('label','LABEL','string',()=>undefined,{LABEL:'Hello there'}).value,'Hello there');
 assert.equal(environmentOverride('label','LABEL','string',()=>undefined,{LABEL:''}).value,'');
});

test('workspace environment values win, frozen values use defaults, hidden values still evaluate',()=>{
 const data=emptyData();data.features.push(feature(data,{id:'mcp',name:'MCP'}),feature(data,{id:'internal',name:'Internal',hidden:true}));
 data.privileges.push(privilege(data,{featureId:'mcp',key:'mcp_enabled',name:'MCP',type:'boolean',default:false,envVariable:'MCP_ENABLED'}),privilege(data,{featureId:'mcp',key:'max_exports',name:'Exports',type:'integer',minimum:0,maximum:10,envVariable:'MAX_EXPORTS'}),privilege(data,{featureId:'mcp',key:'mode',name:'Mode',type:'string',enum:['read','write'],default:'read',envVariable:'MODE'}),privilege(data,{featureId:'mcp',key:'label',name:'Label',type:'string',default:'Default',envVariable:'LABEL'}),privilege(data,{featureId:'internal',key:'internal_enabled',name:'Internal',type:'boolean',default:true}),privilege(data,{featureId:'mcp',key:'frozen_limit',name:'Fixed',type:'integer',default:3,frozen:true}));
 data.tiers.push(tier({id:'business',name:'Business',rank:1}));data.variants.push(variant(data,{id:'business',name:'Business',tierId:'business',kind:'standard',values:{mcp_enabled:true,frozen_limit:100}}));data.organizations.push(organization(data,{id:'acme',name:'Acme',variantId:'business',terms:{max_exports:9,frozen_limit:200}}));
 const env={MCP_ENABLED:'False',MAX_EXPORTS:'7',MODE:'write',LABEL:'Hello there'},bindings=catalogEnvironment(data,env);
 assert.equal(resolve(data,'acme','mcp_enabled',new Date(),bindings).value,false);assert.equal(resolve(data,'acme','max_exports',new Date(),bindings).value,7);assert.equal(resolve(data,'acme','mode',new Date(),bindings).value,'write');assert.equal(resolve(data,'acme','label',new Date(),bindings).value,'Hello there');
 assert.equal(resolve(data,'acme','frozen_limit',new Date(),bindings).value,3);assert.equal(resolve(data,'acme','frozen_limit',new Date(),bindings).reason,'FROZEN');assert.equal(resolve(data,'acme','internal_enabled',new Date(),bindings).value,true);assert.equal(data.organizations[0]!.terms.max_exports,9);
 assert.throws(()=>catalogEnvironment(data,{...env,MAX_EXPORTS:'-5'}),/Catalog constraints/);assert.throws(()=>catalogEnvironment(data,{...env,MODE:'root'}),/Catalog constraints/);
 assert.throws(()=>privilege(data,{featureId:'internal',key:'missing',name:'Missing',type:'boolean'}),/default or an environment binding/);
 assert.throws(()=>privilege(data,{featureId:'mcp',key:'frozen_missing',name:'Missing',type:'boolean',frozen:true}),/default or an environment binding/);
});

test('self-hosted YAML Catalog enforces typed bindings, frozen defaults and hidden evaluation over OEREP',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'oe-environment-')),path=join(dir,'catalog.yaml');
 const source={features:[{code:'mcp',name:'MCP',gate:'mcp_enabled',privileges:[{key:'mcp_enabled',valueType:'boolean',default:true,envVariable:'MCP_ENABLED'},{key:'max_calls',valueType:'integer',default:3,envVariable:'MAX_CALLS'},{key:'mode',valueType:'enum',options:['read','write'],default:'read',envVariable:'MODE'},{key:'fixed_limit',valueType:'integer',default:2,frozen:true}]},{code:'internal',name:'Internal',hidden:true,privileges:[{key:'internal_enabled',valueType:'boolean',default:true}]}]};
 await writeFile(path,stringify(source));const env={OE_CATALOG:path,MCP_ENABLED:'False',MAX_CALLS:'7',MODE:'write',PORT:'0'};
 let running:Awaited<ReturnType<typeof startServer>>|undefined;
 try{
  const rt=await buildRuntime(configFromEnv(env));try{
   const meta={actor:'test',reason:'fixture'};await rt.client.admin.upsertPlan({id:'business',name:'Business'},meta);await rt.client.admin.setPlanValue('business','mcp_enabled',true,meta);await rt.client.admin.setPlanValue('business','max_calls',100,meta);await rt.client.admin.setPlanValue('business','fixed_limit',200,meta);await rt.client.admin.assignPlan('acme','business',meta);await rt.client.admin.createGrant({organizationId:'acme',privilege:'max_calls',amount:25},meta);
   assert.equal(await rt.client.isEnabled('mcp',{organizationId:'acme'}),false);assert.equal((await rt.client.getDetails('max_calls',{organizationId:'acme'})).value,7);assert.equal((await rt.client.getDetails('max_calls',{organizationId:'acme'})).grants.length,0);assert.equal((await rt.client.getDetails('fixed_limit',{organizationId:'acme'})).value,2);
  }finally{await rt.close();}
  running=await startServer(configFromEnv(env));
  for(const [key,value] of [['mcp_enabled',false],['max_calls',7],['mode','write'],['fixed_limit',2],['internal_enabled',true]] as const){const response:Response=await fetch(running.url+'/oerep/v1/resolve/'+key,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({context:{organizationId:'acme'}})});assert.equal(response.status,200);const details=await response.json();assert.equal(details.value,value);if(key==='max_calls')assert.equal(details.environment.variable,'MAX_CALLS');}
  await assert.rejects(buildRuntime(configFromEnv({...env,MAX_CALLS:'-5'})),/Catalog constraints/);
 }finally{await running?.close();await rm(dir,{recursive:true,force:true});}
});
