import {useState} from 'react';
import {Catalog} from '../../../console/web/src/workspace/catalog';
import {ValuesEditor} from '../../../console/web/src/workspace/fields';
import {emptyData,group,tag,privilege,resolve,valueError,type Value,type WorkspaceData} from '../../../console/server/workspace/model';
import {parsePrivilege} from '../../../sdk-js/packages/core/src/authoring';
import {storedDefinition} from '../../../console/server/workspace/catalog-adapter';
import './catalog-demo.css';

function example():WorkspaceData {
 return {...emptyData(),
  groups:[{id:'assistant',name:'Document assistant',description:'Access and capacity for your customers.'},{id:'integrations',name:'Integrations',description:'Connect your tools.',parentId:'assistant'}],
  tags:[{id:'capacity',name:'Capacity',description:''},{id:'access',name:'Access',description:''}],
  privileges:[
   {key:'seat_max',name:'Seats',description:'Members in an organization.',type:'integer',minimum:0,unlimited:true,default:5,groupId:'assistant',tags:['capacity']},
   {key:'ai_tokens',name:'AI tokens',description:'Allowance supplied to your application.',type:'integer',minimum:0,unlimited:true,default:{unlimited:true},groupId:'assistant',tags:['capacity']},
   {key:'export_enabled',name:'Document export',description:'Export documents to other tools.',type:'boolean',default:true,groupId:'assistant',tags:['access']},
   {key:'mcp_enabled',name:'MCP access',description:'Requires the MCP connector.',type:'boolean',default:true,envVariable:'MCP_INSTALLED',groupId:'integrations',tags:['access']},
  ],
  tiers:[{id:'business',name:'Business',rank:0,gracePeriodDays:0},{id:'enterprise',name:'Enterprise',rank:1,gracePeriodDays:0}],
  variants:[{id:'business',name:'Business standard',tierId:'business',kind:'standard',values:{seat_max:25,ai_tokens:10000}},{id:'enterprise',name:'Enterprise standard',tierId:'enterprise',kind:'standard',values:{seat_max:{unlimited:true}}}],
  organizations:[{id:'globex',name:'Globex',variantId:'business',status:'active',terms:{seat_max:40}}],
 };
}
const environment={mcp_enabled:{variable:'MCP_INSTALLED',configuredValue:'false',value:false}};
const display=(v:Value|undefined)=>v===undefined?'Required':typeof v==='object'?'∞ Unlimited':typeof v==='boolean'?(v?'Enabled':'Disabled'):v.toLocaleString();
export default function CatalogDemo(){
 const [data,setData]=useState(example),[page,setPage]=useState('Catalog'),[tierId,setTierId]=useState('business'),[error,setError]=useState(''),[editingCatalog,setEditingCatalog]=useState(false);
 const org=data.organizations[0]!,tier=data.variants.find(v=>v.id===tierId)!,assigned=data.variants.find(v=>v.id===org.variantId)!;
 const definitions=data.privileges.filter(p=>!p.hidden);
 function valid(values:Record<string,Value>){return Object.entries(values).every(([key,v])=>{const p=data.privileges.find(p=>p.key===key);return p&&!valueError(p,v);});}
 async function save(resource:string,input:unknown){
  try{
   const next=structuredClone(data);
   if(resource==='catalog'){const row=privilege(next,storedDefinition(parsePrivilege(input)));next.privileges=[...next.privileges.filter(p=>p.key!==row.key),row];}
   else if(resource==='groups'){const row=group(next,input);next.groups=[...next.groups.filter(g=>g.id!==row.id),row];}
   else if(resource==='tags'){const row=tag(input);next.tags=[...next.tags.filter(t=>t.id!==row.id),row];}
   else throw new Error('Unsupported demo action');
   setData(next);setError('');return true;
  }catch(e){setError((e as Error).message);return false;}
 }
 return <section className="catalog-demo" aria-label="Interactive Privilege Catalog">
  <header className="demo-header"><strong>ACME Workspace</strong><span>Demo · changes stay in this page</span><button type="button" onClick={()=>{setData(example());setError('');setTierId('business');setEditingCatalog(false);}}>Reset demo</button></header>
  <nav aria-label="Demo views">{['Catalog','Tiers','Organization'].map(name=><button type="button" key={name} aria-current={page===name?'page':undefined} onClick={()=>{setPage(name);setError('');}}>{name==='Catalog'?'Privilege Catalog':name}</button>)}</nav>
  <div className="demo-content">
   {page==='Catalog'&&<div className="demo-catalog-action"><button type="button" onClick={()=>setEditingCatalog(!editingCatalog)}>{editingCatalog?'Finish editing':'Edit Catalog'}</button></div>}
   {error&&<p role="alert">{error}</p>}
   {page==='Catalog'&&<Catalog workspace={{id:'acme',name:'ACME',role:'Owner',data,revision:1,environment}} save={save} canEdit={editingCatalog} busy={false}/>}
   {page==='Tiers'&&<><label className="demo-select">Tier variant<select value={tierId} onChange={e=>setTierId(e.target.value)}>{data.variants.map(v=><option key={v.id} value={v.id}>{v.name}</option>)}</select></label><ValuesEditor definitions={definitions} base={{}} values={tier.values} environment={environment} onChange={values=>setData({...data,variants:data.variants.map(v=>v.id===tierId?{...v,values}:v)})}/></>}
   {page==='Organization'&&<><label className="demo-select">Globex's tier<select aria-label="Globex tier" value={org.variantId} onChange={e=>setData({...data,organizations:[{...org,variantId:e.target.value,terms:{}}]})}>{data.variants.map(v=><option key={v.id} value={v.id}>{v.name}</option>)}</select></label><ValuesEditor definitions={definitions} base={Object.fromEntries(definitions.filter(p=>Object.hasOwn(assigned.values,p.key)||p.default!==undefined).map(p=>[p.key,Object.hasOwn(assigned.values,p.key)?assigned.values[p.key]!:p.default!]))} values={org.terms} environment={environment} onChange={terms=>setData({...data,organizations:[{...org,terms}]})}/></>}
   {page!=='Catalog'&&<section className="demo-results" aria-label="Resolved values" aria-live="polite"><h3>Effective for Globex</h3>{valid(org.terms)&&valid(assigned.values)?definitions.map(p=>{let result;try{result=resolve(data,'globex',p.key,new Date('2026-11-10T12:00:00Z'),environment);}catch{return <div key={p.key}><span>{p.name}</span><strong>Value required</strong><small>Set a Tier value</small></div>;}return <div key={p.key}><span>{p.name}</span><strong>{display(result.value)}</strong><small>{({CONTRACT:'Organization override',VARIANT:'Tier variant',DEFAULT:'Catalog default',ENVIRONMENT:'Environment restriction',FROZEN:'Read-only default'} as Record<string,string>)[result.reason]??result.reason}</small></div>;}):<p>Correct the invalid value to evaluate.</p>}</section>}
  </div>
 </section>;
}
