import { stringify } from "yaml";
import type { Meta, Plan } from "./api.ts";

/** Export only the public administration read models, never connection credentials. */
export function configurationYaml(meta: Meta, plans: Plan[]): string {
  return "# Read-only console snapshot. YAML import is not supported.\n" + stringify({
    format: "openentitlement-console-snapshot",
    formatVersion: 1,
    specVersion: meta.specVersion,
    catalog: meta.catalog,
    ...(meta.capabilities.inspection ? { plans } : {}),
  }, { aliasDuplicateObjects: false });
}
