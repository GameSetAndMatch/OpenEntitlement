/** Boolean Catalog install prerequisites. Only explicitly bound variables are exposed. */
export interface EnvironmentOverride { variable:string; configuredValue:string; value:boolean }
export type EnvironmentOverrides=Record<string,EnvironmentOverride>;
export function environmentOverride(key:string,variable:unknown,type:'boolean'|'integer'|'string'|'enum',validate:(value:unknown)=>string|undefined,env:NodeJS.ProcessEnv):EnvironmentOverride {
 if(type!=='boolean')throw new Error(`${key}: environment bindings support boolean privileges only`);
 if(typeof variable!=='string'||!/^[A-Z][A-Z0-9_]*$/.test(variable))throw new Error(`${key}: envVariable must be an uppercase environment variable name`);
 const raw=env[variable];if(raw===undefined)throw new Error(`${key}: required environment variable ${variable} is unset`);
 if(!/^(true|false|1|0)$/i.test(raw.trim()))throw new Error(`${key}: ${variable} must be a boolean`);
 const value=/^(true|1)$/i.test(raw.trim());
 if(validate(value))throw new Error(`${key}: environment variable ${variable} does not satisfy the Catalog constraints`);
 return {variable,configuredValue:raw,value};
}
export function environmentMessage(binding:EnvironmentOverride){return `Restricted by environment variable '${binding.variable}=${binding.configuredValue}'. Access requires both the entitlement and this variable to be true. This binding cannot be changed manually.`;}
