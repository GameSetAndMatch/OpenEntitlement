import assert from 'node:assert/strict';
import {test} from 'node:test';
import {parsePrivilege,type IntegerPrivilege} from '../server/workspace/privilege-definition.ts';
import {normalizeCatalog,catalogDefinition} from '../server/workspace/catalog-adapter.ts';
import {emptyData} from '../server/workspace/model.ts';

test('typed Privileges have visibility, one Group, multiple Tags and a boolean-only environment field',()=>{
 const input={key:'mcp_enabled',title:'MCP access',description:'Allow MCP access',type:'boolean',visibility:'read_only',default:false,env_override:'MCP_INSTALLED',group_id:'mcp',tags:['enterprise','integration']};
 assert.deepEqual(parsePrivilege(input),input);
 assert.throws(()=>parsePrivilege({...input,type:'integer'}),/Unknown integer Privilege field: env_override/);
 assert.throws(()=>parsePrivilege({...input,type:'enum'}),/Unknown enum Privilege field: env_override/);
 assert.throws(()=>parsePrivilege({...input,group_ids:['mcp','other']}),/Unknown/);
 assert.throws(()=>parsePrivilege({...input,tags:['same','same']}),/unique/);
 assert.throws(()=>parsePrivilege({...input,visibility:'frozen'}),/visibility/);
 assert.throws(()=>parsePrivilege({key:'seats',title:'Seats',type:'integer',default:true}),/out of bounds/);
 assert.throws(()=>parsePrivilege({key:'mode',title:'Mode',type:'enum',enum:['read'],default:'write'}),/choices/);
 const typed:IntegerPrivilege={key:'seats',title:'Seats',description:'',visibility:'editable',tags:[],type:'integer'};
 // @ts-expect-error Integer privileges cannot carry an environment binding.
 typed.env_override='SEATS';
});

test('legacy Feature containers become stable Groups while preserving visibility and stored values',()=>{
 const data=emptyData();data.groups.push({id:'product',name:'Product',description:''},{id:'feature_exports',name:'Existing group',description:''});data.features.push({id:'exports',name:'Exports',description:'Export controls',groupId:'product'});data.privileges.push({key:'max_exports',name:'Maximum exports',description:'',featureId:'exports',type:'integer',default:5});
 normalizeCatalog(data);const id=data.privileges[0]!.groupId;assert.notEqual(id,'feature_exports');assert.equal(data.groups.find(g=>g.id===id)!.parentId,'product');const count=data.groups.length;normalizeCatalog(data);assert.equal(data.groups.length,count);assert.equal(catalogDefinition(data.privileges[0]!,data).group_id,id);
});

import {parseCatalog,standaloneCatalog} from '../server/workspace/privilege-definition.ts';
test('Catalog validates Group and Tag relationships and adapts supported standalone definitions',()=>{
 const catalog={groups:[{id:'mcp',title:'MCP'}],tags:[{id:'enterprise',title:'Enterprise'},{id:'integration',title:'Integration'}],privileges:[{key:'mcp_enabled',title:'MCP access',type:'boolean',default:false,group_id:'mcp',tags:['enterprise','integration'],env_override:'MCP_INSTALLED'}]};
 assert.equal(parseCatalog(catalog).privileges[0]!.group_id,'mcp');assert.equal((standaloneCatalog(catalog) as any).features[0].privileges[0].envVariable,'MCP_INSTALLED');
 assert.throws(()=>parseCatalog({...catalog,tags:[]}),/unknown Tag/);
 assert.throws(()=>parseCatalog({...catalog,groups:[{id:'mcp',title:'MCP',parent_id:'mcp'}]}),/cycle/);
 assert.throws(()=>standaloneCatalog({privileges:[{key:'seats',title:'Seats',type:'integer',default:5,maximum:10}]}),/Bounded integer/);
});
