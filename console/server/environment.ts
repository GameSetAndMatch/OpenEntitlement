/** Typed Catalog bindings. Only explicitly bound variables are read or exposed. */
export interface EnvironmentOverride { variable:string; configuredValue:string; value:boolean|number|string }
export type EnvironmentOverrides=Record<string,EnvironmentOverride>;
export function environmentOverride(key:string,variable:unknown,type:'boolean'|'integer'|'string'|'enum',validate:(value:unknown)=>string|undefined,env:NodeJS.ProcessEnv):EnvironmentOverride {
 if(typeof variable!=='string'||!/^[A-Z][A-Z0-9_]*$/.test(variable))throw new Error(`${key}: envVariable must be an uppercase environment variable name`);
 const raw=env[variable];if(raw===undefined)throw new Error(`${key}: required environment variable ${variable} is unset`);
 let value:boolean|number|string=raw;
 if(type==='boolean'){
  if(!/^(true|false|1|0)$/i.test(raw.trim()))throw new Error(`${key}: ${variable} must be a boolean`);
  value=/^(true|1)$/i.test(raw.trim());
 }else if(type==='integer'){
  if(!/^[+-]?\d+$/.test(raw.trim())||!Number.isSafeInteger(Number(raw)))throw new Error(`${key}: ${variable} must be a whole number`);
  value=Number(raw);
 }
 const problem=validate(value);if(problem)throw new Error(`${key}: environment variable ${variable} does not satisfy the Catalog constraints`);
 return {variable,configuredValue:raw,value};
}
export function environmentMessage(binding:EnvironmentOverride){return `Controlled by environment variable '${binding.variable}=${binding.configuredValue}'. This value cannot be changed manually.`;}
