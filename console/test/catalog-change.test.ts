import assert from "node:assert/strict";
import { test } from "node:test";
import { emptyData, privilege, tier, variant, organization, changePrivilege, ownValueHolders, resolve, type WorkspaceData } from "../server/workspace/model.ts";

/** Pro and Trial variants, an Organization Acme with terms, and one application user. */
function workspace(): WorkspaceData {
  const d = emptyData();
  d.privileges.push(privilege(d, { key: "seats", name: "Seats", type: "integer", default: 5 }));
  d.tiers.push(tier({ id: "pro", name: "Pro", rank: 1, gracePeriodDays: 0 }));
  d.variants.push(variant(d, { id: "pro", name: "Pro", tierId: "pro", kind: "standard", values: { seats: 10 } }));
  d.variants.push(variant(d, { id: "pro_trial", name: "Pro trial", tierId: "pro", kind: "trial" }));
  d.organizations.push(organization(d, { id: "acme", name: "Acme", variantId: "pro", terms: { seats: 25 } }));
  d.organizations.push(organization(d, { id: "globex", name: "Globex", variantId: "pro" }));
  d.subjects.push({ organizationId: "acme", subjectId: "alice", name: "Alice", variantId: "pro", terms: { seats: 30 }, grants: { seats: 2 } });
  return d;
}

test("a new Privilege without a Catalog default takes every existing variant's value in the same change", () => {
  const d = workspace();
  assert.throws(() => changePrivilege(d, { key: "exports", name: "Exports", type: "integer" }), /Set exports in every existing variant/);
  changePrivilege(d, { key: "exports", name: "Exports", type: "integer" }, { pro: 3, pro_trial: 1 });
  assert.equal(d.privileges.find(p => p.key === "exports")!.default, undefined);
  assert.deepEqual(d.variants.map(v => v.values.exports), [3, 1]);
  assert.equal(resolve(d, "globex", "exports").value, 3);
});

test("variant values are validated against the new definition and only fill variants without their own value", () => {
  // A failed change is discarded as a whole, so each attempt starts from the same workspace.
  assert.throws(() => changePrivilege(workspace(), { key: "exports", name: "Exports", type: "integer" }, { pro: -1, pro_trial: 1 }), /0 or greater/);
  assert.throws(() => changePrivilege(workspace(), { key: "exports", name: "Exports", type: "integer" }, { pro: 1, missing: 1 }), /Variant not found: missing/);
  assert.throws(() => changePrivilege(workspace(), { key: "exports", name: "Exports", type: "integer", default: 0 }, { pro: 1 }), /only for a Privilege without a Catalog default/);
  // Removing the default: Pro already sets its own value, so only Pro trial needs one.
  assert.throws(() => changePrivilege(workspace(), { key: "seats", name: "Seats", type: "integer" }, { pro: 4, pro_trial: 5 }), /Pro already sets its own value/);
  const d = workspace();
  changePrivilege(d, { key: "seats", name: "Seats", type: "integer" }, { pro_trial: 5 });
  assert.deepEqual(d.variants.map(v => v.values.seats), [10, 5]);
  assert.equal(Object.hasOwn(d.privileges.find(p => p.key === "seats")!, "default"), false);
});

test("making a Privilege Read-only removes the values records set themselves, in the same change", () => {
  const d = workspace();
  assert.deepEqual(ownValueHolders(d, "seats"), ["Pro", "Acme", "Alice (Acme)"]);
  changePrivilege(d, { key: "seats", name: "Seats", type: "integer", default: 5, frozen: true });
  assert.deepEqual(ownValueHolders(d, "seats"), []);
  assert.equal(Object.hasOwn(d.variants[0]!.values, "seats"), false);
  assert.equal(Object.hasOwn(d.organizations[0]!.terms, "seats"), false);
  assert.equal(Object.hasOwn(d.subjects[0]!.terms, "seats"), false);
  // A Grant is an allowance, not a value of its own; it stays and has no effect while Read-only.
  assert.deepEqual(d.subjects[0]!.grants, { seats: 2 });
  assert.equal(resolve(d, "acme", "seats", new Date(), {}, "alice").value, 5);
});

test("Hidden and Editable Privileges keep the values records set themselves", () => {
  const d = workspace();
  changePrivilege(d, { key: "seats", name: "Seats", type: "integer", default: 5, hidden: true });
  assert.deepEqual(ownValueHolders(d, "seats"), ["Pro", "Acme", "Alice (Acme)"]);
});
