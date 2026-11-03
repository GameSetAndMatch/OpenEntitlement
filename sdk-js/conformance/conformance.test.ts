/**
 * Run spec/assets/gherkin against every available target.
 *
 *   npm test                                   # in-memory, fixed, Stripe (fake account)
 *   OE_PG_DSN=postgresql://... npm test        # + Postgres
 */

import { readdirSync, readFileSync } from "node:fs";
import { after, describe, it } from "node:test";
import { Catalog } from "@openentitlement/core";
import { parse, type Scenario } from "./gherkin.ts";
import { runStep, World, type Target } from "./steps.ts";
import { fixedTarget, memoryTarget, postgresTarget, stripeTarget } from "./targets.ts";

const SPEC = new URL("../../spec/assets/", import.meta.url);
const CATALOG = Catalog.fromJSON(JSON.parse(readFileSync(new URL("catalog.json", SPEC), "utf8")));
const PLANS = JSON.parse(readFileSync(new URL("plans.json", SPEC), "utf8"));
const GHERKIN = new URL("gherkin/", SPEC);
const SCENARIOS: Scenario[] = readdirSync(GHERKIN)
  .filter((f) => f.endsWith(".feature"))
  .sort()
  .flatMap((f) => parse(new URL(f, GHERKIN).pathname));
const CAPABILITY_TAGS = new Set(["overrides", "grants", "mutations", "plan-catalog", "fixed"]);

const targets: Target[] = [memoryTarget, fixedTarget, stripeTarget];
if (process.env.OE_PG_DSN) targets.push(await postgresTarget(process.env.OE_PG_DSN));

function applies(t: Target, s: Scenario): boolean {
  const needed = [...s.tags].filter((x) => CAPABILITY_TAGS.has(x));
  if (t.tags.has("fixed") !== needed.includes("fixed")) return false;
  return needed.every((x) => t.tags.has(x));
}

for (const target of targets) {
  describe(`conformance: ${target.name}`, () => {
    after(async () => target.teardown?.());
    for (const s of SCENARIOS) {
      const skip = applies(target, s) ? false : `${target.name} lacks ${[...s.tags].filter((x) => CAPABILITY_TAGS.has(x)).join(", ")}`;
      it(s.id, { skip }, async () => {
        const w = new World(target, CATALOG, PLANS);
        for (const st of s.steps) {
          await runStep(w, st.keyword, st.text);
          if (st.keyword === "Given" && w.error !== undefined) throw w.error;
        }
        if (!w.errorConsumed) throw new Error(`unasserted error: ${String(w.error)}`);
      });
    }
  });
}

describe("conformance coverage", () => {
  it("every scenario runs on some target", () => {
    for (const s of SCENARIOS) if (!targets.some((t) => applies(t, s))) throw new Error(`no target runs ${s.id}`);
  });
});
