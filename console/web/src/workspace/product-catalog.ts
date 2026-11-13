/** Explicit adapter between the canonical Python Catalog and Tiers and the preview console components. */
import {emptyData,type WorkspaceData,type Group,type Tag,type Value,type Tier,type Variant,type StatusPolicy} from '../../../server/workspace/model.ts';
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
