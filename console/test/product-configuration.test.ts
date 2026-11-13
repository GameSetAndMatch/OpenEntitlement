import assert from "node:assert/strict";
import { test } from "node:test";
import { parse } from "yaml";
import { configurationYaml } from "../web/src/workspace/configuration.ts";
import { tiersData, organizationsData, subjectsData, type ProductCatalog, type ProductTiers, type ProductOrganizations } from "../web/src/workspace/product-catalog.ts";

// Two Products of one Workspace that both define `seats`, each with its own Tier and a hidden Privilege.
function product(id: string, seats: number, tier: string, hidden: string) {
  const catalog: ProductCatalog = { variants: [], versions: {}, catalog: { groups: [], tags: [], privileges: [
    { key: "seats", title: "Seats", description: "", type: "integer", visibility: "editable", tags: [], default: seats },
    { key: hidden, title: "Internal", description: "", type: "boolean", visibility: "hidden", tags: [], default: true },
  ] } };
  const tiers: ProductTiers = { tiers: [{ id: tier, name: tier, rank: 0, gracePeriodDays: 0, version: 1 }], policyVersion: 1,
    variants: [{ id: `${tier}_standard`, tierId: tier, kind: "standard", name: `${tier} standard`, version: 1, values: { seats: seats * 2, [hidden]: false } }],
    policy: { pastDue: { action: "readOnly" }, ended: { action: "readOnly" } } };
  return { id, catalog, tiers };
}
const analytics = product("p-analytics", 5, "pro", "internal_beta"), storage = product("p-storage", 100, "team", "storage_secret");
const organizations: ProductOrganizations = { organizations: [{ id: "acme", name: "Acme", version: 1, products: [
  { productId: "p-analytics", variantId: "pro_standard", tierId: "pro", status: "active", terms: { seats: 25, internal_beta: false }, version: 1, effectiveVariantId: "pro_standard", grace: false, fallback: false, readOnly: false, values: [],
    users: [{ subjectId: "alice", name: "Alice", variantId: "pro_standard", terms: { internal_beta: true }, grants: { seats: 5 }, version: 1, state: "active", values: [] }] },
] }, { id: "globex", name: "Globex", version: 1, products: [] }] };
const snapshot = (p: typeof analytics) => parse(configurationYaml(
  { id: "w1", name: "Acme Inc", data: { ...tiersData(p.catalog, p.tiers), organizations: organizationsData(organizations, p.id), subjects: subjectsData(organizations, p.id) } },
  { id: p.id, key: p.id.slice(2), name: p.id.slice(2) },
));

test("each Product exports only its own Catalog, Tiers and assignments, without hidden values", () => {
  const a = snapshot(analytics), s = snapshot(storage);
  assert.deepEqual(a.product, { id: "p-analytics", key: "analytics", name: "analytics" });
  assert.deepEqual(a.privileges.map((p: { key: string; default: unknown }) => [p.key, p.default]), [["seats", 5]]);
  assert.deepEqual(s.privileges.map((p: { key: string; default: unknown }) => [p.key, p.default]), [["seats", 100]]);
  assert.deepEqual(a.tiers.map((t: { id: string }) => t.id), ["pro"]);
  assert.deepEqual(s.tiers.map((t: { id: string }) => t.id), ["team"]);
  assert.deepEqual(a.variants.map((v: { values: unknown }) => v.values), [{ seats: 10 }]);
  assert.deepEqual(s.variants.map((v: { values: unknown }) => v.values), [{ seats: 200 }]);
  // Organizations are Workspace-wide; a Product exports those it assigns a Tier variant, with their terms there.
  assert.deepEqual(a.organizations.map((o: { id: string; terms: unknown }) => [o.id, o.terms]), [["acme", { seats: 25 }]]);
  assert.deepEqual(s.organizations, []);
  assert.deepEqual(a.subjects.map((u: { subjectId: string; terms: unknown; grants: unknown }) => [u.subjectId, u.terms, u.grants]), [["alice", {}, { seats: 5 }]]);
  assert.deepEqual(s.subjects, []);
  assert.doesNotMatch(configurationYaml({ id: "w1", name: "Acme Inc", data: tiersData(storage.catalog, storage.tiers) }), /storage_secret|internal_beta/);
});
