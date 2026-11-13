/** The read-only YAML snapshot on Settings → Configuration. Hidden Privileges and their values never appear in it. */
import { stringify } from "yaml";
import { catalogDefinition } from "../../../server/workspace/catalog-adapter.ts";
import type { WorkspaceData } from "../../../server/workspace/model.ts";

/** The Product a snapshot covers. On the Python service each Product has its own Catalog and Tiers, so it exports one Product. */
export interface SnapshotProduct { id: string; key: string; name: string }

export function configurationYaml(w: { id: string; name: string; data: WorkspaceData }, product?: SnapshotProduct): string {
  const data = w.data;
  const hidden = new Set(data.privileges.filter(p => p.hidden || data.features.find(f => f.id === p.featureId)?.hidden).map(p => p.key));
  const visibleValues = <T,>(values: Record<string, T>) => Object.fromEntries(Object.entries(values).filter(([key]) => !hidden.has(key)));
  return stringify({
    format: "openentitlement-workspace-snapshot", formatVersion: 1, workspace: { id: w.id, name: w.name },
    ...(product ? { product: { id: product.id, key: product.key, name: product.name } } : {}),
    ...data, hostedTier: undefined, features: undefined,
    groups: data.groups.map(g => ({ id: g.id, title: g.name, description: g.description, ...(g.parentId ? { parentId: g.parentId } : {}) })),
    tags: data.tags.map(t => ({ id: t.id, title: t.name, description: t.description })),
    privileges: data.privileges.filter(p => !hidden.has(p.key)).map(p => catalogDefinition(p, data)),
    variants: data.variants.map(v => ({ ...v, values: visibleValues(v.values) })),
    // Organizations are Workspace-wide on the Python service: a Product exports those it gives a Tier variant.
    organizations: data.organizations.filter(o => o.variantId).map(o => ({ ...o, terms: visibleValues(o.terms) })),
    subjects: data.subjects.map(s => ({ ...s, terms: visibleValues(s.terms), grants: visibleValues(s.grants) })),
  });
}
