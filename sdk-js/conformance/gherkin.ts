/** A minimal Gherkin parser: Feature, Background, Scenario, Scenario Outline, Examples, tags. No dependencies. */

import { readFileSync } from "node:fs";
import { basename } from "node:path";

export interface Step {
  keyword: "Given" | "When" | "Then";
  text: string;
  line: number;
}

export interface Scenario {
  feature: string;
  name: string;
  tags: Set<string>;
  steps: Step[];
  id: string;
}

interface Outline {
  name: string;
  tags: Set<string>;
  line: number;
  steps: Step[];
  examples: Array<{ tags: Set<string>; header: string[]; rows: string[][] }>;
}

const cells = (line: string) => line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());

export function parse(path: string): Scenario[] {
  let featureName = "";
  let featureTags = new Set<string>();
  const background: Step[] = [];
  const items: Outline[] = [];
  let pending = new Set<string>();
  let current: Outline | undefined;
  let inBackground = false;
  let lastKw: Step["keyword"] = "Given";
  readFileSync(path, "utf8")
    .split("\n")
    .forEach((raw, i) => {
      const n = i + 1;
      const line = raw.trim();
      if (!line || line.startsWith("#")) return;
      if (line.startsWith("@")) {
        for (const t of line.split(/\s+/)) pending.add(t.slice(1));
        return;
      }
      if (line.startsWith("Feature:")) {
        featureName = line.slice(8).trim();
        featureTags = pending;
        pending = new Set();
        return;
      }
      if (line.startsWith("Background:")) {
        inBackground = true;
        current = undefined;
        return;
      }
      const sc = /^(Scenario Outline|Scenario Template|Scenario|Example):\s*(.*)$/.exec(line);
      if (sc) {
        inBackground = false;
        current = { name: sc[2]!, tags: new Set([...featureTags, ...pending]), line: n, steps: [], examples: [] };
        items.push(current);
        pending = new Set();
        return;
      }
      if (line.startsWith("Examples:") || line.startsWith("Scenarios:")) {
        if (!current) throw new SyntaxError(`${path}:${n}: Examples outside a scenario`);
        current.examples.push({ tags: pending, header: [], rows: [] });
        pending = new Set();
        return;
      }
      if (line.startsWith("|")) {
        const ex = current?.examples.at(-1);
        if (!ex) throw new SyntaxError(`${path}:${n}: table outside Examples`);
        if (ex.header.length === 0) ex.header.push(...cells(line));
        else ex.rows.push(cells(line));
        return;
      }
      const st = /^(Given|When|Then|And|But|\*)\s+(.*)$/.exec(line);
      if (!st) throw new SyntaxError(`${path}:${n}: cannot parse ${JSON.stringify(line)}`);
      const kw = (["And", "But", "*"].includes(st[1]!) ? lastKw : st[1]) as Step["keyword"];
      lastKw = kw;
      (inBackground ? background : current!.steps).push({ keyword: kw, text: st[2]!, line: n });
    });

  const stem = basename(path, ".feature");
  const out: Scenario[] = [];
  for (const it of items) {
    if (it.examples.length === 0) {
      out.push({ feature: featureName, name: it.name, tags: it.tags, steps: [...background, ...it.steps], id: `${stem}:${it.line}:${it.name}` });
      continue;
    }
    for (const ex of it.examples) {
      ex.rows.forEach((row, i) => {
        const values = Object.fromEntries(ex.header.map((h, j) => [h, row[j] ?? ""]));
        const sub = (t: string) => t.replace(/<([^<>]+)>/g, (m, k: string) => values[k] ?? m);
        const name = `${it.name} [${Object.entries(values).map(([k, v]) => `${k}=${v}`).join(", ")}]`;
        out.push({
          feature: featureName,
          name,
          tags: new Set([...it.tags, ...ex.tags]),
          steps: [...background, ...it.steps.map((s) => ({ ...s, text: sub(s.text) }))],
          id: `${stem}:${it.line + i}:${name}`,
        });
      });
    }
  }
  return out;
}
