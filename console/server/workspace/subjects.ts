import { object, only, text, values, valueError, WorkspaceError, type WorkspaceData, type SubjectEntitlement } from './model.ts';
/** External application identity; never an OpenEntitlement account or role. */
export function subjectIdentifier(input:unknown):string {
  if(typeof input!=='string'||!input.trim()||input!==input.trim()||input.length>200||/[\u0000-\u001f\u007f]/.test(input))throw new WorkspaceError('Subject ID must be a non-empty application identifier (maximum 200 characters, no surrounding whitespace or control characters)');
  return input;
}
export function subject(data:WorkspaceData,input:unknown):SubjectEntitlement {
  const b=object(input);only(b,['organizationId','subjectId','name','terms','grants']);
  const org=data.organizations.find(o=>o.id===b.organizationId);
  if(!org)throw new WorkspaceError('Organization not found',404);
  const result:SubjectEntitlement={organizationId:org.id,subjectId:subjectIdentifier(b.subjectId),name:text(b.name,'User display name'),variantId:org.variantId,terms:values(data,b.terms??{}),grants:{}};
  for(const [key,amount] of Object.entries(object(b.grants??{}))){
    const def=data.privileges.find(p=>p.key===key);
    if(!def||def.type!=='integer'||typeof amount!=='number'||!Number.isSafeInteger(amount)||amount<=0)throw new WorkspaceError(`${key}: grants require a positive whole-number allowance on an integer privilege`,422);
    result.grants[key]=amount;
  }
  for(const key of new Set([...Object.keys(result.terms),...Object.keys(result.grants)])){
    const def=data.privileges.find(p=>p.key===key)!;
    if(def.frozen||def.envVariable||data.features.find(f=>f.id===def.featureId)?.frozen)throw new WorkspaceError(`${key}: locked privileges cannot have user terms or grants`,422);
  }
  return result;
}
/** Keep definition/default/Organization edits from invalidating stored personal allowances. */
export function validateSubjects(data:WorkspaceData){
  for(const row of data.subjects){
    values(data,row.terms);
    for(const [key,amount] of Object.entries(row.grants)){
      const def=data.privileges.find(p=>p.key===key);
      if(!def||def.type!=='integer'||!Number.isSafeInteger(amount)||amount<=0)throw new WorkspaceError(`${key}: existing user grant would become invalid`,409);
      const org=data.organizations.find(o=>o.id===row.organizationId)!;
      if(row.variantId!==org.variantId)continue;
      const variant=data.variants.find(v=>v.id===org.variantId)!;
      const base=Object.hasOwn(row.terms,key)?row.terms[key]:Object.hasOwn(org.terms,key)?org.terms[key]:Object.hasOwn(variant.values,key)?variant.values[key]:def.default;
      if(typeof base==='number'){const error=valueError(def,base+amount);if(error)throw new WorkspaceError(`User allowance would become invalid: ${error}`,422);}
    }
  }
}
