// The shared Privilege Catalog contract: Zod agrees with the committed JSON Schema
// (generated from the Pydantic models) and with the shared fixtures.
// The Python counterpart is sdk-python/tests/test_catalog_contract.py.
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { test } from "node:test";
import { z } from "zod";
import { PrivilegeCatalogSchema } from "../packages/core/src/authoring.ts";

const root = new URL("../../", import.meta.url);
const read = (path: string) =>
  JSON.parse(readFileSync(new URL(path, root), "utf8")) as Record<string, unknown>;
const fixtures = (kind: "valid" | "invalid") => {
  const dir = `spec/assets/catalog-fixtures/${kind}/`;
  return readdirSync(new URL(dir, root))
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => ({ name: f, ...read(dir + f) }) as { name: string; catalog: unknown });
};

test("shared fixture sets are present", () => {
  assert.ok(fixtures("valid").length >= 10);
  assert.ok(fixtures("invalid").length >= 15);
});
for (const fixture of fixtures("valid"))
  test(`Zod accepts valid fixture ${fixture.name}`, () => {
    const result = PrivilegeCatalogSchema.safeParse(fixture.catalog);
    assert.ok(result.success, result.error?.message);
  });
for (const fixture of fixtures("invalid"))
  test(`Zod rejects invalid fixture ${fixture.name}`, () => {
    assert.equal(PrivilegeCatalogSchema.safeParse(fixture.catalog).success, false);
  });

type Json = unknown;
/** Inline $refs and drop keywords that carry no validation (titles, docs, discriminator hints). */
function normalize(node: Json, defs: Record<string, Json>): Json {
  if (Array.isArray(node)) return node.map((n) => normalize(n, defs));
  if (!node || typeof node !== "object") return node;
  const object = node as Record<string, Json>;
  if (typeof object.$ref === "string") {
    const { $ref, ...rest } = object;
    const target = defs[$ref.replace("#/$defs/", "")];
    return normalize({ ...(target as object), ...rest }, defs);
  }
  const out: Record<string, Json> = {};
  for (const [key, value] of Object.entries(object)) {
    if (["$schema", "$id", "$defs", "title", "description", "discriminator"].includes(key)) continue;
    if (key === "default" && "const" in object) continue;
    if (key === "properties") {
      out[key] = Object.fromEntries(
        Object.entries(value as object).map(([k, v]) => [k, normalize(v, defs)]),
      );
      continue;
    }
    out[key === "oneOf" ? "anyOf" : key] = key === "required" ? [...(value as string[])].sort() : normalize(value, defs);
  }
  return out;
}

test("Zod's JSON Schema agrees structurally with the committed Pydantic-generated schema", () => {
  const committed = read("spec/schemas/privilege-catalog.schema.json");
  const zod = z.toJSONSchema(PrivilegeCatalogSchema, { io: "input", target: "draft-2020-12" }) as Record<string, Json>;
  assert.equal(committed.$schema, zod.$schema);
  assert.deepEqual(
    normalize(zod, (zod.$defs ?? {}) as Record<string, Json>),
    normalize(committed, (committed.$defs ?? {}) as Record<string, Json>),
  );
});
