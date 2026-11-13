/** Explicit adapter between the canonical Python Catalog and the preview console components. */
import {emptyData,type WorkspaceData,type Group,type Tag,type Value} from '../../../server/workspace/model.ts';
import {storedDefinition} from '../../../server/workspace/catalog-adapter.ts';
import type {Privilege} from '../../../server/workspace/privilege-definition.ts';
export interface CatalogVariant {id:string;name:string;version:number;values:Record<string,Value>}
export type VariantInputs=Record<string,{version:number;value:Value}>;
export interface ProductCatalog {variants:CatalogVariant[];catalog:{groups:Array<{id:string;title:string;description:string;parentId?:string}>;tags:Array<{id:string;title:string;description:string}>;privileges:Privilege[]};versions:Record<string,Record<string,number>>}
export function catalogData(view:ProductCatalog):WorkspaceData {
 return {...emptyData(),groups:view.catalog.groups.map(({title,...g})=>({...g,name:title})),tags:view.catalog.tags.map(({title,...t})=>({...t,name:title})),privileges:view.catalog.privileges.map(p=>storedDefinition(p) as unknown as WorkspaceData['privileges'][number])};
}
export function catalogEntry(section:string,entry:unknown):{entry:unknown;kind:string;key:string;variantValues?:VariantInputs;expectedVersion?:number}{
 if(section==='catalog'){const {variantValues,expectedVersion,...p}=entry as Privilege&{variantValues?:VariantInputs;expectedVersion?:number};return {entry:p,kind:'privileges',key:p.key,variantValues,expectedVersion};}
 const {name,expectedVersion,...meta}=entry as (Group|Tag)&{expectedVersion?:number};return {entry:{...meta,title:name},kind:section,key:meta.id,expectedVersion};
}
