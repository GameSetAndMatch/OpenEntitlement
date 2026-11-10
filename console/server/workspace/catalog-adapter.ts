/** Public Privilege model over the preview's existing persisted representation. */
import type {Privilege as StoredPrivilege,WorkspaceData} from './model.ts';
import {parsePrivilege,type Privilege} from './privilege-definition.ts';
export function catalogDefinition(p:StoredPrivilege,data:WorkspaceData):Privilege {
 const feature=data.features.find(f=>f.id===p.featureId);
 const common={key:p.key,title:p.name,description:p.description,visibility:p.hidden||feature?.hidden?'hidden':p.frozen||feature?.frozen?'read_only':'editable',...(p.groupId?{groupId:p.groupId}:{}),tags:p.tags??[],...(Object.hasOwn(p,'default')?{default:p.default}:{})};
 if(p.type==='boolean')return parsePrivilege({...common,type:'boolean',...(p.envVariable?{envOverride:p.envVariable}:{})});
 if(p.type==='integer')return parsePrivilege({...common,type:'integer',...(p.minimum!==undefined?{minimum:p.minimum}:{}),...(p.maximum!==undefined?{maximum:p.maximum}:{}),...(p.unlimited!==undefined?{unlimited:p.unlimited}:{})});
 const choices=p.enum??[...new Set([p.default,...data.variants.map(v=>v.values[p.key]),...data.organizations.map(o=>o.terms[p.key]),...(data.subjects??[]).map(s=>s.terms[p.key])].filter((v):v is string=>typeof v==='string'))];
 return parsePrivilege({...common,type:'enum',enum:choices.length?choices:['']});
}
export function storedDefinition(p:Privilege):Record<string,unknown>{return {key:p.key,name:p.title,description:p.description,type:p.type==='enum'?'string':p.type,groupId:p.groupId,tags:p.tags,hidden:p.visibility==='hidden',frozen:p.visibility==='read_only',...(Object.hasOwn(p,'default')?{default:p.default}:{}),...(p.type==='boolean'&&p.envOverride?{envVariable:p.envOverride}:{}),...(p.type==='integer'?{minimum:p.minimum,maximum:p.maximum,unlimited:p.unlimited}:{}),...(p.type==='enum'?{enum:p.enum}:{})};}
export function normalizeCatalog(data:WorkspaceData):WorkspaceData {
 data.tags??=[];
 data.subjects??=[];
 // Old Feature containers become Groups without discarding metadata or assignments.
 for(const f of data.features){let suffix=0,id=`feature_${f.id.slice(0,55)}`;const siblings=new Set(data.groups.map(g=>g.id));while(siblings.has(id)&&!data.groups.some(g=>g.id===id&&g.legacyFeatureId===f.id))id=`feature_${++suffix}_${f.id.slice(0,55)}`;
  if(!data.groups.some(g=>g.id===id))data.groups.push({id,name:f.name,description:f.description,...(f.groupId?{parentId:f.groupId}:{}),legacyFeatureId:f.id});
  for(const p of data.privileges)if(p.featureId===f.id)p.groupId=id;
 }
 return data;
}
