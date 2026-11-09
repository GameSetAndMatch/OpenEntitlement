import assert from "node:assert/strict";
import { test } from "node:test";
import {
  emptyData,
  privilege,
  tier,
  variant,
  organization,
  resolve,
} from "../server/workspace/model.ts";
import {
  subject,
  subjectIdentifier,
  validateSubjects,
} from "../server/workspace/subjects.ts";
import {
  hosting,
  requireSubjectEntitlements,
  deploymentMode,
} from "../server/workspace/hosting.ts";
function fixture() {
  const d = emptyData();
  d.privileges.push(
    privilege(d, {
      key: "ai_tokens",
      name: "AI tokens",
      type: "integer",
      default: 100,
      maximum: 1000,
      unlimited: true,
    }),
    privilege(d, {
      key: "export_enabled",
      name: "Export",
      type: "boolean",
      default: false,
    }),
    privilege(d, {
      key: "retention",
      name: "Retention",
      type: "string",
      enum: ["30d", "365d"],
      default: "30d",
    }),
  );
  d.tiers.push(tier({ id: "pro", name: "Pro", rank: 1, gracePeriodDays: 3 }));
  d.variants.push(
    variant(d, { id: "pro", name: "Pro", tierId: "pro", kind: "standard" }),
    variant(d, { id: "trial", name: "Trial", tierId: "pro", kind: "trial" }),
    variant(d, {
      id: "grace",
      name: "Grace",
      tierId: "pro",
      kind: "grace",
      values: { ai_tokens: 1 },
    }),
  );
  for (const id of ["acme", "globex"])
    d.organizations.push(
      organization(d, {
        id,
        name: id,
        variantId: "pro",
        terms: { ai_tokens: 200 },
      }),
    );
  d.subjects.push(
    subject(d, {
      organizationId: "acme",
      subjectId: "idp|alice",
      name: "Alice",
      terms: { ai_tokens: 300, export_enabled: true, retention: "365d" },
      grants: { ai_tokens: 50 },
    }),
  );
  return d;
}
test("personal terms and additive allowances inherit and are isolated by Organization and subject", () => {
  const d = fixture();
  assert.equal(resolve(d, "acme", "ai_tokens").value, 200);
  assert.equal(
    resolve(d, "acme", "ai_tokens", undefined, undefined, "bob").value,
    200,
  );
  assert.equal(
    resolve(d, "globex", "ai_tokens", undefined, undefined, "idp|alice").value,
    200,
  );
  const r = resolve(d, "acme", "ai_tokens", undefined, undefined, "idp|alice");
  assert.equal(r.value, 350);
  assert.equal(r.reason, "SUBJECT_GRANT");
  assert.equal(r.grantApplied, 50);
  assert.equal(
    resolve(d, "acme", "retention", undefined, undefined, "idp|alice").value,
    "365d",
  );
  assert.equal(
    resolve(d, "acme", "export_enabled", undefined, undefined, "idp|alice")
      .value,
    true,
  );
  d.subjects[0]!.terms.ai_tokens = { unlimited: true };
  assert.deepEqual(
    resolve(d, "acme", "ai_tokens", undefined, undefined, "idp|alice").value,
    { unlimited: true },
  );
  assert.equal(
    resolve(d, "acme", "ai_tokens", undefined, undefined, "idp|alice")
      .grantApplied,
    0,
  );
});
test("variant changes retain inert personal terms and persistent grants; grace/fallback suspend them and readOnly survives", () => {
  const d = fixture();
  d.organizations[0]!.variantId = "trial";
  assert.equal(
    resolve(d, "acme", "ai_tokens", undefined, undefined, "idp|alice").value,
    250,
  );
  assert.equal(
    resolve(d, "acme", "ai_tokens", undefined, undefined, "idp|alice")
      .subjectState,
    "stale",
  );
  d.organizations[0]!.variantId = "pro";
  d.organizations[0] = organization(
    d,
    { ...d.organizations[0], status: "past_due" },
    new Date("2027-01-01T00:00:00Z"),
  );
  assert.equal(
    resolve(
      d,
      "acme",
      "ai_tokens",
      new Date("2027-01-02T00:00:00Z"),
      {},
      "idp|alice",
    ).value,
    1,
  );
  assert.equal(
    resolve(
      d,
      "acme",
      "ai_tokens",
      new Date("2027-01-02T00:00:00Z"),
      {},
      "idp|alice",
    ).subjectState,
    "suspended",
  );
  assert.equal(
    resolve(
      d,
      "acme",
      "ai_tokens",
      new Date("2027-01-05T00:00:00Z"),
      {},
      "idp|alice",
    ).readOnly,
    true,
  );
  d.statusPolicy.past_due = { action: "fallback", variantId: "trial" };
  assert.equal(
    resolve(
      d,
      "acme",
      "ai_tokens",
      new Date("2027-01-05T00:00:00Z"),
      {},
      "idp|alice",
    ).value,
    100,
  );
});
test("frozen defaults and boolean environment veto remain final; invalid user data fails", () => {
  const d = fixture();
  const env = {
    export_enabled: {
      variable: "MCP_INSTALLED",
      configuredValue: "False",
      value: false,
    },
  };
  assert.equal(
    resolve(d, "acme", "export_enabled", undefined, env, "idp|alice").value,
    false,
  );
  d.privileges[0]!.maximum = 100;
  d.privileges[0]!.frozen = true;
  assert.equal(
    resolve(d, "acme", "ai_tokens", undefined, undefined, "idp|alice").value,
    100,
  );
  for (const input of [
    { terms: { ai_tokens: -5 } },
    { terms: { retention: "invalid" } },
    { grants: { export_enabled: 1 } },
    { grants: { ai_tokens: 0 } },
    { grants: { ai_tokens: 1.5 } },
  ])
    assert.throws(() =>
      subject(d, {
        organizationId: "acme",
        subjectId: "new",
        name: "New",
        ...input,
      }),
    );
  assert.throws(
    () =>
      subject(d, {
        organizationId: "missing",
        subjectId: "alice",
        name: "Alice",
      }),
    /Organization not found/,
  );
  for (const id of ["", null, 42, " alice", "alice\n"])
    assert.throws(() => subjectIdentifier(id));
});
test("editing defaults or constraints cannot silently invalidate a personal allowance", () => {
  const d = fixture();
  validateSubjects(d);
  d.variants[0]!.values.ai_tokens = 1000;
  d.organizations[0]!.terms = {};
  d.subjects[0]!.terms = {};
  assert.throws(() => validateSubjects(d), /allowance would become invalid/);
});
test("hosting capability is independent of customer Tiers and fails closed on Cloud Pro", () => {
  const d = fixture();
  assert.equal(hosting(d, "self_hosted").subjectEntitlements, true);
  assert.equal(hosting(d, "saas").subjectEntitlements, false);
  assert.throws(
    () => requireSubjectEntitlements(d, "saas"),
    /Cloud Enterprise/,
  );
  d.hostedTier = "enterprise";
  assert.equal(hosting(d, "saas").subjectEntitlements, true);
  assert.equal(deploymentMode({}), "self_hosted");
  assert.throws(() => deploymentMode({ OE_DEPLOYMENT_MODE: "invalid" }));
});


test("inherited object names are not treated as personal grants", () => {
  const data = fixture();
  data.privileges.push(privilege(data, { key: "constructor", name: "Constructor allowance", type: "integer", default: 5 }));
  assert.equal(resolve(data, "acme", "constructor", undefined, undefined, "idp|alice").value, 5);
});
