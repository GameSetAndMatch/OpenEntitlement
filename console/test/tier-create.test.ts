import { test } from "node:test";
import assert from "node:assert/strict";
import { variantName, uniqueIdentifier } from "../web/src/workspace/identifier.ts";
import { tier, variant, type WorkspaceData } from "../server/workspace/model.ts";

test("derived variant names stay within the server's limit for any valid tier name", () => {
  const name = "P".repeat(200);
  assert.doesNotThrow(() => tier({ id: "pro", name, rank: 0, gracePeriodDays: 0 }));
  for (const suffix of ["standard", "trial", "grace period"]) {
    const derived = variantName(name, suffix);
    assert.ok(derived.length <= 200, `${suffix}: ${derived.length}`);
    assert.ok(derived.endsWith(` ${suffix}`));
    const data = { tiers: [{ id: "pro", name, rank: 0, gracePeriodDays: 0 }], variants: [], privileges: [] } as unknown as WorkspaceData;
    assert.doesNotThrow(() => variant(data, { id: uniqueIdentifier(derived, "variant", []), name: derived, tierId: "pro", kind: suffix === "grace period" ? "grace" : suffix, values: {} }));
  }
  assert.equal(variantName("Pro", "standard"), "Pro standard");
});
