import {Catalog} from '../../../console/web/src/workspace/catalog';
import {ValuesEditor} from '../../../console/web/src/workspace/fields';
import {emptyData,resolve,type WorkspaceData} from '../../../console/server/workspace/model';
import './product-scenes.css';
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

const data=example();
const noop=()=>{};
const labels:Record<string,string>={CONTRACT:'Organization override',VARIANT:'Tier value',DEFAULT:'Catalog default',ENVIRONMENT:'Environment restriction'};
export default function ProductScenes(){
 const catalogData={...data,groups:data.groups.filter(g=>g.id==='assistant'),privileges:data.privileges.filter(p=>p.key!=='mcp_enabled')};
 const org=data.organizations[0]!;
 return <div className="product-scenes">
  <section className="product-scene" aria-labelledby="define-privileges">
   <div className="scene-copy"><h2 id="define-privileges">Define what you offer.</h2><p>Access, limits and unlimited allowances, in one Privilege Catalog.</p></div>
   <figure aria-label="Privilege Catalog showing Seats, unlimited AI tokens and enabled document export"><div className="product-screen" inert aria-hidden="true"><header>ACME / Privilege Catalog</header><Catalog workspace={{id:'acme',name:'ACME',role:'User',data:catalogData,revision:1}} save={async()=>false} canEdit={false} busy={false}/></div><figcaption className="sr-only">Seats: 5. AI tokens: unlimited. Document export: enabled.</figcaption></figure>
  </section>
  <section className="product-scene" aria-labelledby="set-tier-values">
   <div className="scene-copy"><h2 id="set-tier-values">Package it into Tiers.</h2><p>Each Tier reuses the Catalog and changes only what differs.</p></div>
   <figure aria-label="Enterprise standard Tier with unlimited seats and document export enabled"><div className="product-screen" inert aria-hidden="true"><header>Enterprise / Standard variant</header><ValuesEditor definitions={data.privileges.filter(p=>['seat_max','export_enabled'].includes(p.key))} base={{}} values={{seat_max:{unlimited:true},export_enabled:true}} onChange={noop}/></div><figcaption className="sr-only">Enterprise standard sets seats to unlimited and enables document export.</figcaption></figure>
  </section>
  <section className="product-scene" aria-labelledby="customer-exceptions">
   <div className="scene-copy"><h2 id="customer-exceptions">Explain every exception.</h2><p>Globex has 40 seats instead of 25. Every value says where it came from.</p></div>
   <figure aria-label="Globex entitlement values with a 40-seat override and MCP restricted by the environment"><div className="product-screen"><header>Globex / Business standard</header><dl className="resolved-values">{data.privileges.filter(p=>['seat_max','ai_tokens','mcp_enabled'].includes(p.key)).map(p=>{const result=resolve(data,org.id,p.key,new Date('2026-11-10T12:00:00Z'),environment);return <div key={p.key}><dt>{p.name}<code>{p.key}</code></dt><dd><strong>{typeof result.value==='boolean'?(result.value?'Enabled':'Disabled'):typeof result.value==='object'?'∞':result.value?.toLocaleString()}</strong><span className="source-label">{labels[result.reason]}</span>{p.key==='seat_max'&&<small>Business includes 25</small>}{result.environment&&<small>MCP_INSTALLED=false</small>}</dd></div>;})}</dl></div><figcaption className="sr-only">Values come from the same resolver used by the console.</figcaption></figure>
  </section>
 </div>;
}
