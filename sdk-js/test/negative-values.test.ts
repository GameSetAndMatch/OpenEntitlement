import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Catalog, checkWithin, decodeRemoteDetails, feature, integer } from "@openentitlement/core";
import { standaloneCatalog } from "@openentitlement/core/authoring";

const catalog = new Catalog([feature("climate", "Climate", [integer("temperature_offset", { default: 0 })])]);
const p = catalog.privilege("temperature_offset")!;
const details = (value: number, grants: unknown[] = []) =>
  decodeRemoteDetails({ privilege: "temperature_offset", value, reason: "PLAN", grants, staleOverrides: [] }, p, { subjectId: "alice" });

describe("negative integer values", () => {
  it("decodes negative remote values, with and without grants", () => {
    assert.equal(details(-5).value, -5);
    assert.equal(details(5, [{ id: "g", amount: 10 }]).value, 5); // base -5 plus a grant of 10
    assert.equal(details(-(2 ** 53 - 1)).value, -(2 ** 53 - 1));
    assert.throws(() => details(-(2 ** 53)));
  });
  it("never lets a personal grant allow more than the resolved value", () => {
    const d = details(10, [{ id: "g", amount: 100, subjectId: "alice" }]); // base -90
    assert.equal(checkWithin(d, 0, 10).passed, true);
    assert.equal(checkWithin(d, 0, 11).passed, false);
    assert.equal(checkWithin(details(-5), 0, 1).passed, false);
  });
  it("standalone catalogs reject any explicit bound, including a negative minimum", () => {
    const catalogWith = (bounds: object) => ({ privileges: [{ key: "temperature_offset", title: "Offset", type: "integer", default: 0, ...bounds }] });
    assert.throws(() => standaloneCatalog(catalogWith({ minimum: -10 })), /workspace service/);
    assert.throws(() => standaloneCatalog(catalogWith({ maximum: 10 })), /workspace service/);
  });
});
