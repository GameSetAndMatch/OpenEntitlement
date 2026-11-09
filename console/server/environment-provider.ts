import type {Provider} from '@openentitlement/core';
import type {EnvironmentOverrides} from './environment.ts';
/** Environment values replace the final result while preserving stored commercial data. */
export function withEnvironmentOverrides(provider:Provider,bindings:EnvironmentOverrides,frozen:Record<string,unknown>={}):Provider {
 return new Proxy(provider,{get(target,key){
  if(key==='resolve')return async(...args:Parameters<Provider['resolve']>)=>{
   const details=await target.resolve(...args);const binding=Object.hasOwn(bindings,args[0].key)?bindings[args[0].key]:undefined;
   return binding||Object.hasOwn(frozen,args[0].key)?{...details,value:binding?binding.value:frozen[args[0].key],frozen:true,reason:'FIXED',grants:[],requiredPlan:undefined,environment:binding}:details;
  };
  if(key==='suggestPlan')return async(...args:Parameters<NonNullable<Provider['suggestPlan']>>)=>(Object.hasOwn(bindings,args[0].key)||Object.hasOwn(frozen,args[0].key))?undefined:target.suggestPlan?.(...args);
  const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;
 }}) as Provider;
}
