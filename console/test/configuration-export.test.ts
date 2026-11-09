import assert from "node:assert/strict";
import { test } from "node:test";
import { parse } from "yaml";
import { configurationYaml } from "../web/src/configuration-export.ts";
import type { Meta, Plan } from "../web/src/api.ts";
import { startServer } from "../server/main.ts";
import { configFromEnv } from "../server/config.ts";

test("YAML snapshot preserves actual catalog and plan values, including unlimited and enums", async () => {
  const service = await startServer({ ...configFromEnv({}), port: 0, seedDemo: true });
  try {
    const meta = await (await fetch(service.url + "/api/meta")).json() as Meta;
    const plans = await (await fetch(service.url + "/api/plans")).json() as Plan[];
    plans[0]!.name = "true: #quoted\nmultiline";
    const snapshot = parse(configurationYaml(meta, plans));
    assert.deepEqual(snapshot.catalog, meta.catalog);
    assert.deepEqual(snapshot.plans, plans);
    assert.ok(plans.some(p => Object.values(p.values).some(v => v?.unlimited === true)));
    assert.deepEqual(Object.keys(snapshot).sort(), ["catalog", "format", "formatVersion", "plans", "specVersion"]);
    assert.equal(snapshot.format, "openentitlement-console-snapshot");
    const fixed = parse(configurationYaml({ ...meta, capabilities: { ...meta.capabilities, inspection: false } }, plans));
    assert.equal("plans" in fixed, false);
    assert.deepEqual(fixed.catalog, meta.catalog);
  } finally { await service.close(); }
});
