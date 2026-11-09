/** Operator-owned component availability; never grants commercial entitlement. */
export interface DeploymentCondition { variable:string; configuredValue:string; available:boolean }
export type DeploymentConditions=Record<string,DeploymentCondition>;
export function deploymentFromEnv(env:NodeJS.ProcessEnv=process.env):DeploymentConditions {
  let mapping:unknown;
  try{mapping=JSON.parse(env.OE_FEATURE_ENV_GATES??"{}");}catch{throw new Error("OE_FEATURE_ENV_GATES must be a JSON object mapping feature IDs to environment variable names");}
  if(!mapping||typeof mapping!=="object"||Array.isArray(mapping))throw new Error("OE_FEATURE_ENV_GATES must be an object");
  const result:DeploymentConditions={};
  for(const [feature,variable] of Object.entries(mapping)){
    if(!/^[a-z][a-z0-9_]*(\.[a-z0-9_]+)*$/.test(feature)||typeof variable!=="string"||! /^[A-Z][A-Z0-9_]*$/.test(variable))throw new Error("Deployment gates require feature IDs and uppercase environment variable names");
    const raw=env[variable]?.trim();
    if(raw!==undefined&&!/^(true|false|1|0)$/i.test(raw))throw new Error(`Deployment variable ${variable} must be true, false, 1 or 0`);
    result[feature]={variable,configuredValue:raw??"unset",available:raw!==undefined&&/^(true|1)$/i.test(raw)};
  }
  return result;
}
export function deploymentMessage(condition:DeploymentCondition){return condition.available?`Component installed (${condition.variable}=${condition.configuredValue}). Customer entitlements still apply.`:`Overridden by environment variable '${condition.variable}=${condition.configuredValue}'. This component is not installed.`;}
