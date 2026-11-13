import assert from "node:assert/strict";
import { test } from "node:test";
import { userRequest, type ProductOrganizations } from "../web/src/workspace/product-catalog.ts";

const alice = { subjectId: "tenant/42|alice", name: "Alice", variantId: "pro_standard", terms: {}, grants: { seats: 5 }, version: 3, state: "active" as const, values: [] };
const view: ProductOrganizations = { organizations: [{ id: "acme", name: "Acme", version: 1, products: [{
  productId: "p1", variantId: "pro_standard", tierId: "pro", status: "active", terms: {}, version: 1, effectiveVariantId: "pro_standard",
  grace: false, fallback: false, readOnly: false, values: [], users: [alice],
}] }] };

test("removing an application user sends the reason in the body, never in the address (ADR-0010 Q13)", () => {
  const entry = { organizationId: "acme", subjectId: alice.subjectId };
  const removal = userRequest("/api/workspaces/w", entry, view, "p1", "DELETE", "Pilot over");
  assert.deepEqual(removal, {
    path: "/api/workspaces/w/organizations/acme/products/p1/users/tenant%2F42%7Calice?version=3",
    method: "DELETE",
    body: { reason: "Pilot over" },
  });
  assert.doesNotMatch(removal.path, /reason|Pilot/);
  // Without Personal terms or Grants there is no reason to send.
  assert.deepEqual(userRequest("/api/workspaces/w", entry, view, "p1", "DELETE").body, {});
});
