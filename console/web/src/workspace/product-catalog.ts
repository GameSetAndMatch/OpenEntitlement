/** Explicit adapter between the canonical Python Catalog and Tiers and the preview console components. */
import {emptyData,type WorkspaceData,type Group,type Tag,type Value,type Tier,type Variant,type StatusPolicy,type Organization,type SubjectEntitlement} from '../../../server/workspace/model.ts';
import {storedDefinition} from '../../../server/workspace/catalog-adapter.ts';
import type {Privilege} from '../../../server/workspace/privilege-definition.ts';
export interface CatalogVariant {id:string;tierId:string;kind:Variant['kind'];name:string;version:number;values:Record<string,Value>}
export type VariantInputs=Record<string,{version:number;value:Value}>;
export interface ProductCatalog {variants:CatalogVariant[];catalog:{groups:Array<{id:string;title:string;description:string;parentId?:string}>;tags:Array<{id:string;title:string;description:string}>;privileges:Privilege[]};versions:Record<string,Record<string,number>>}
/** A Tier as the Python service returns it: archived Tiers carry the time they were archived. */
export interface TierRecord extends Tier {archivedAt?:string|null;version:number}
export interface ProductTiers {tiers:TierRecord[];variants:CatalogVariant[];policy:{pastDue:StatusPolicy;ended:StatusPolicy};policyVersion:number}
/** The console's Tier rows: the preview shape, plus when a Tier was archived. */
export type TierRow=Tier&{archivedAt?:string};
export function catalogData(view:ProductCatalog):WorkspaceData {
 return {...emptyData(),groups:view.catalog.groups.map(({title,...g})=>({...g,name:title})),tags:view.catalog.tags.map(({title,...t})=>({...t,name:title})),privileges:view.catalog.privileges.map(p=>storedDefinition(p) as unknown as WorkspaceData['privileges'][number])};
}
export function tiersData(catalog:ProductCatalog,view:ProductTiers):WorkspaceData {
 return {...catalogData(catalog),
  tiers:view.tiers.map(({version:_version,archivedAt,...t}):TierRow=>({...t,...(archivedAt?{archivedAt}:{})})),
  variants:view.variants.map(({id,name,tierId,kind,values})=>({id,name,tierId,kind,values})),
  statusPolicy:{past_due:view.policy.pastDue,ended:view.policy.ended}};
}
export function catalogEntry(section:string,entry:unknown):{entry:unknown;kind:string;key:string;variantValues?:VariantInputs;expectedVersion?:number}{
 if(section==='catalog'){const {variantValues,expectedVersion,...p}=entry as Privilege&{variantValues?:VariantInputs;expectedVersion?:number};return {entry:p,kind:'privileges',key:p.key,variantValues,expectedVersion};}
 const {name,expectedVersion,...meta}=entry as (Group|Tag)&{expectedVersion?:number};return {entry:{...meta,title:name},kind:section,key:meta.id,expectedVersion};
}
/** The console's Tier sections that the Python service serves per Product. */
export const tierSections=['tiers','variants','policy','tier-archive','tier-restore','tier-delete'];
/** The Python request for a Tiers page save, with the version of the record it was made from. */
export function tierRequest(base:string,section:string,entry:unknown,view:ProductTiers):{path:string;method:string;body?:unknown}{
 const tierVersion=(id:string)=>view.tiers.find(t=>t.id===id)?.version??0;
 if(section==='tiers'){
  const {standard,...tier}=entry as Tier&{standard?:Variant};
  // The guided creation saves the Tier with its standard variant, in one transaction.
  if(standard)return {path:`${base}/tiers`,method:'POST',body:{tier:{id:tier.id,name:tier.name,rank:tier.rank},standard:{id:standard.id,name:standard.name,values:standard.values}}};
  return {path:`${base}/tiers/${tier.id}`,method:'PATCH',body:{name:tier.name,rank:tier.rank,gracePeriodDays:tier.gracePeriodDays,version:tierVersion(tier.id)}};
 }
 if(section==='variants'){
  const v=entry as Variant;
  return {path:`${base}/tiers/${v.tierId}/variants/${v.id}`,method:'PUT',body:{name:v.name,kind:v.kind,values:v.values,version:view.variants.find(x=>x.id===v.id)?.version??0}};
 }
 if(section==='policy'){
  const p=entry as WorkspaceData['statusPolicy'];
  return {path:`${base}/status-policy`,method:'PUT',body:{pastDue:p.past_due,ended:p.ended,version:view.policyVersion}};
 }
 const {id}=entry as {id:string};
 if(section==='tier-delete')return {path:`${base}/tiers/${id}?version=${tierVersion(id)}`,method:'DELETE'};
 return {path:`${base}/tiers/${id}/${section==='tier-archive'?'archive':'restore'}`,method:'POST',body:{version:tierVersion(id)}};
}
/** An Organization's Tier variant in one Product, with its values as the Python SDK resolved them. */
export interface ResolvedValue {privilege:string;value:Value|null;source:'default'|'variant'|'organizationTerms'|'personalTerms'|'grant'|'gracePeriod'|'environment'|'error';sourceName:string;error?:string|null}
/** An application user's Personal terms and Grants in one Product, with its values as the Python SDK resolved them (none on Cloud Pro). */
export interface ApplicationUser {subjectId:string;name:string;variantId:string;terms:Record<string,Value>;grants:Record<string,number>;version:number;state:'active'|'stale'|'suspended';values:ResolvedValue[]}
export interface OrganizationProduct {productId:string;variantId:string;tierId:string;status:Organization['status'];graceEndsAt?:string|null;terms:Record<string,Value>;version:number;effectiveVariantId:string;grace:boolean;fallback:boolean;readOnly:boolean;values:ResolvedValue[];users:ApplicationUser[]}
export interface ProductOrganizations {organizations:Array<{id:string;name:string;version:number;products:OrganizationProduct[]}>}
/** The console's Organization rows for one Product. An Organization without a variant there has an empty variantId. */
export function organizationsData(view:ProductOrganizations,productId:string):Organization[]{
 return view.organizations.map(o=>{const assigned=o.products.find(p=>p.productId===productId);
  return {id:o.id,name:o.name,variantId:assigned?.variantId??'',terms:assigned?.terms??{},status:assigned?.status??'active',...(assigned?.graceEndsAt?{graceEndsAt:assigned.graceEndsAt}:{})};});
}
/** The values the service resolved for an Organization in one Product, by Privilege. */
export function resolvedValues(view:ProductOrganizations,organizationId:string,productId:string):OrganizationProduct|undefined{
 return view.organizations.find(o=>o.id===organizationId)?.products.find(p=>p.productId===productId);
}
const same=(a:Record<string,Value>,b:Record<string,Value>)=>{const keys=new Set([...Object.keys(a),...Object.keys(b)]);return [...keys].every(k=>JSON.stringify(a[k])===JSON.stringify(b[k]));};
/** Whether saving the Organization changes its Organization terms in the Product, which needs a reason. */
export function changesOrganizationTerms(view:ProductOrganizations,entry:Organization,productId:string):boolean{
 return !same(resolvedValues(view,entry.id,productId)?.terms??{},entry.terms);
}
/** The Python requests for an Organizations page save: create, rename and the Tier variant in this Product. */
export function organizationRequests(base:string,entry:Organization,view:ProductOrganizations,productId:string,reason?:string):Array<{path:string;method:string;body:unknown}>{
 const existing=view.organizations.find(o=>o.id===entry.id);
 const assignment={variantId:entry.variantId,status:entry.status,terms:entry.terms};
 const why=reason?{reason}:{};
 // Without a Tier variant (the Product has none yet), only the Organization itself is saved.
 if(!existing)return [{path:`${base}/organizations`,method:'POST',body:{id:entry.id,name:entry.name,...(entry.variantId?{assignment:{productId,...assignment},...why}:{})}}];
 const requests=[];
 if(existing.name!==entry.name)requests.push({path:`${base}/organizations/${entry.id}`,method:'PATCH',body:{name:entry.name,version:existing.version}});
 const current=existing.products.find(p=>p.productId===productId);
 // A rename alone leaves the Tier variant, its status and terms as they are.
 if(!entry.variantId)return requests;
 if(current&&current.variantId===entry.variantId&&current.status===entry.status&&same(current.terms,entry.terms)&&requests.length)return requests;
 requests.push({path:`${base}/organizations/${entry.id}/products/${productId}`,method:'PUT',body:{...assignment,version:current?.version??0,...why}});
 return requests;
}
/** The console's application-user rows for one Product. */
export function subjectsData(view:ProductOrganizations,productId:string):SubjectEntitlement[]{
 return view.organizations.flatMap(o=>(o.products.find(p=>p.productId===productId)?.users??[]).map(u=>({organizationId:o.id,subjectId:u.subjectId,name:u.name,variantId:u.variantId,terms:u.terms,grants:u.grants})));
}
/** An application user's record and values in one Product. */
export function userValues(view:ProductOrganizations,organizationId:string,subjectId:string,productId:string):ApplicationUser|undefined{
 return resolvedValues(view,organizationId,productId)?.users.find(u=>u.subjectId===subjectId);
}
// What a reason covers: Personal terms with the variant they belong to, and Grants.
const exceptions=(variantId:string,terms:Record<string,Value>,grants:Record<string,number>)=>[Object.keys(terms).length?variantId:null,terms,grants] as const;
const sameExceptions=(a:ReturnType<typeof exceptions>,b:ReturnType<typeof exceptions>)=>a[0]===b[0]&&same(a[1],b[1])&&same(a[2],b[2]);
type UserEntry={organizationId:string;subjectId:string;name?:string;terms?:Record<string,Value>;grants?:Record<string,number>};
/** Whether saving (PUT) or removing (DELETE) an application user changes its Personal terms or Grants, which needs a reason. */
export function changesPersonalExceptions(view:ProductOrganizations,entry:UserEntry,productId:string,method:string):boolean{
 const assigned=resolvedValues(view,entry.organizationId,productId),current=assigned?.users.find(u=>u.subjectId===entry.subjectId);
 const before=current?exceptions(current.variantId,current.terms,current.grants):exceptions('',{},{});
 const after=method==='DELETE'?exceptions('',{},{}):exceptions(assigned?.variantId??'',entry.terms??{},entry.grants??{});
 return !sameExceptions(before,after);
}
/** The Python request for an application-user save or removal, with the version it was made from. */
export function userRequest(base:string,entry:UserEntry,view:ProductOrganizations,productId:string,method:string,reason?:string):{path:string;method:string;body?:unknown}{
 const version=userValues(view,entry.organizationId,entry.subjectId,productId)?.version??0;
 const path=`${base}/organizations/${entry.organizationId}/products/${productId}/users/${encodeURIComponent(entry.subjectId)}`;
 // The removal reason travels in the body, never in the address, so access logs never hold it (ADR-0010 Q13).
 if(method==='DELETE')return {path:`${path}?version=${version}`,method,body:reason?{reason}:{}};
 return {path,method:'PUT',body:{name:entry.name,terms:entry.terms??{},grants:entry.grants??{},version,...(reason?{reason}:{})}};
}
