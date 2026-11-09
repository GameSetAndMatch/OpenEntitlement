import assert from "node:assert/strict";
import { test } from "node:test";
import { emptyData, group, privilege, tier, variant, organization, resolve, valueError } from "../server/workspace/model.ts";

test("flat keys, nested groups, typed defaults and inheritance compose without encoding paths", () => {
  const d = emptyData(); d.groups.push(group(d, { id: "product", name: "Product" })); d.groups.push(group(d, { id: "exports", name: "Exports", parentId: "product", description: "Export limits" }));
  assert.throws(() => group(d, { id: "product", name: "Product", parentId: "exports" }), /cycles/);
  assert.throws(() => privilege(d, { key: "exports.max", name: "Exports", type: "integer", default: 1 }), /flat/);
  d.privileges.push(privilege(d, { key: "max_exports", name: "Exports", groupId: "exports", type: "integer", minimum: 0, unlimited: true, default: 5 }));
  assert.match(valueError(d.privileges[0]!, -5)!, /0 or greater/);
  assert.match(valueError(d.privileges[0]!, true)!, /whole number/);
  d.tiers.push(tier({ id: "pro", name: "Pro", rank: 1, gracePeriodDays: 7 }));
  d.variants.push(variant(d, { id: "pro", name: "Pro", tierId: "pro", trial: false }));
  d.organizations.push(organization(d, { id: "acme", name: "Acme", variantId: "pro" }));
  assert.equal(resolve(d, "acme", "max_exports").value, 5);
  d.variants[0]!.values.max_exports = 10; assert.equal(resolve(d, "acme", "max_exports").value, 10);
  d.organizations[0]!.terms.max_exports = 25; assert.equal(resolve(d, "acme", "max_exports").value, 25);
  assert.throws(() => privilege(d, { ...d.privileges[0], maximum: 20 }), /Existing value/);
});

test("past-due grace has a stable deadline and ended status bypasses grace", () => {
  const d = emptyData(); d.privileges.push(privilege(d, { key: "access_enabled", name: "Access", type: "boolean", default: true }));
  d.tiers.push(tier({ id: "pro", name: "Pro", rank: 1, gracePeriodDays: 7 })); d.variants.push(variant(d, { id: "pro", name: "Pro", tierId: "pro", trial: false }));
  const input = { id: "acme", name: "Acme", variantId: "pro", status: "past_due" };
  d.organizations.push(organization(d, input, new Date("2027-01-01T00:00:00Z")));
  const deadline = d.organizations[0]!.graceEndsAt;
  assert.equal(resolve(d, "acme", "access_enabled", new Date("2027-01-07T23:59:59Z")).readOnly, false);
  assert.equal(resolve(d, "acme", "access_enabled", new Date("2027-01-08T00:00:00Z")).readOnly, true);
  d.organizations[0] = organization(d, input, new Date("2027-01-05T00:00:00Z")); assert.equal(d.organizations[0].graceEndsAt, deadline);
  d.organizations[0] = organization(d, { ...input, status: "ended" }); assert.equal(resolve(d, "acme", "access_enabled").readOnly, true);
});
