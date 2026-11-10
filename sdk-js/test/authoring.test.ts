import assert from "node:assert/strict";
import { test } from "node:test";
import { ZodError } from "zod";
import {
  PrivilegeCatalogSchema,
  PrivilegeSchema,
} from "../packages/core/src/authoring.ts";
import { Catalog, feature, integer } from "../packages/core/src/index.ts";
test("optional Zod authoring has strict types, flat keys, metadata and normalized constraints", () => {
  const catalog = PrivilegeCatalogSchema.parse({
    groups: [{ id: "collaboration", title: "Collaboration" }],
    tags: [{ id: "licensed", title: "Licensed" }],
    privileges: [
      {
        key: "seat_max",
        title: "Seats",
        type: "integer",
        default: 5,
        groupId: "collaboration",
        tags: ["licensed"],
      },
    ],
  });
  assert.equal(catalog.privileges[0]!.type, "integer");
  assert.deepEqual(catalog.privileges[0]!.tags, ["licensed"]);
  assert.equal((catalog.privileges[0] as { minimum: number }).minimum, 0);
  for (const value of [true, "5", -5])
    assert.throws(
      () =>
        PrivilegeSchema.parse({
          key: "seat_max",
          title: "Seats",
          type: "integer",
          default: value,
        }),
      ZodError,
    );
  assert.throws(
    () =>
      PrivilegeSchema.parse({
        key: "seat.max",
        title: "Seats",
        type: "integer",
        default: 5,
      }),
    ZodError,
  );
  assert.throws(
    () =>
      PrivilegeSchema.parse({
        key: "seat_max",
        title: "Seats",
        type: "integer",
        default: 5,
        envOverride: "MAX_SEATS",
      }),
    ZodError,
  );
});
test("legacy runtime Catalog keys remain compatible rather than silently renamed", () => {
  const catalog = new Catalog([
    feature("seats", "Seats", [integer("seat.max")]),
  ]);
  assert.equal(catalog.privilege("seat.max")!.key, "seat.max");
  assert.equal(catalog.privilege("seat_max"), undefined);
});
