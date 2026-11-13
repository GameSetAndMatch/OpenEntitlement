/**
 * The dashboards script is the source of truth for the PostHog insights it manages. Its diff mode,
 * run against a snapshot of what PostHog holds, must report no change for the insights fixed by
 * hand in OPE-49; otherwise rerunning the script would undo that work.
 *
 *   node --test tools/posthog/*.test.mjs
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const script = new URL("./dashboards.mjs", import.meta.url).pathname;
const snapshotPath = new URL("./fixtures/ope-49-insights.json", import.meta.url).pathname;
const snapshot = JSON.parse(readFileSync(snapshotPath, "utf8"));

function diff(path) {
  const env = { ...process.env, DIFF: "1", SNAPSHOT: path };
  delete env.POSTHOG_PERSONAL_API_KEY;
  return execFileSync(process.execPath, [script], { env, encoding: "utf8" });
}

const line = (output, insight) =>
  output.split("\n").find((l) => l.split(/ {2,}/)[1] === `${insight.dashboard} / ${insight.name}`);

test("the OPE-49 insights match PostHog's current definitions", () => {
  const output = diff(snapshotPath);
  for (const insight of snapshot.insights) assert.match(line(output, insight) ?? "missing", /^unchanged\b/, insight.name);
});

test("a definition that differs from PostHog is reported as a change", () => {
  const edited = structuredClone(snapshot);
  edited.insights[0].description = "Something else";
  edited.insights[1].query.source.filterTestAccounts = false;
  edited.insights[3].query.source.samplingFactor = 0.1; // set in PostHog, absent here: a write would drop it
  const path = join(mkdtempSync(join(tmpdir(), "posthog-diff-")), "snapshot.json");
  writeFileSync(path, JSON.stringify(edited));
  const output = diff(path);
  assert.match(line(output, edited.insights[0]), /^changed\b.*description/);
  assert.match(line(output, edited.insights[1]), /^changed\b.*query\.source\.filterTestAccounts/);
  assert.match(line(output, edited.insights[3]), /^changed\b.*query\.source\.samplingFactor/);
  assert.match(line(output, edited.insights[2]), /^unchanged\b/);
});
