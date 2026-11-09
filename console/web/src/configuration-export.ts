import { stringify } from "yaml";
import type { Meta, Plan } from "./api.ts";

/** Export only the public administration read models, never connection credentials. */
export function configurationYaml(meta: Meta, plans: Plan[]): string {
  return "# Read-only console snapshot. YAML import is not supported.\n" + stringify({
    format: "openentitlement-console-snapshot",
    formatVersion: 1,
    specVersion: meta.specVersion,
    catalog: meta.catalog.filter(f=>!f.hidden).map(f=>({...f,privileges:f.privileges.filter(p=>!p.hidden).map(p=>{const {environment:_environment,...definition}=p;return definition;})})),
    ...(meta.capabilities.inspection ? { plans:plans.map(p=>({...p,values:Object.fromEntries(Object.entries(p.values).filter(([key])=>!meta.catalog.some(f=>(f.hidden&&f.privileges.some(p=>p.key===key))||f.privileges.some(p=>p.key===key&&p.hidden))))})) } : {}),
  }, { aliasDuplicateObjects: false });
}
