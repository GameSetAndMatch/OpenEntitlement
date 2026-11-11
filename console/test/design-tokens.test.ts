/** Contrast of the console's design tokens, in light and dark (WCAG 2.2: 4.5:1 text, 3:1 controls). */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const css = readFileSync(new URL("../web/src/design.css", import.meta.url), "utf8");
const block = (source: string) => Object.fromEntries([...source.matchAll(/--([a-z-]+):\s*([^;]+);/g)].map(m => [m[1]!, m[2]!.trim()]));
const light = block(css.slice(css.indexOf(":root {"), css.indexOf("@media (prefers-color-scheme: dark)")));
const dark = { ...light, ...block(css.slice(css.indexOf("@media (prefers-color-scheme: dark)"), css.indexOf("/* Type:"))) };

type RGB = [number, number, number];
function parse(value: string, over: RGB): RGB {
  const hex = /^#([0-9a-f]{6})$/i.exec(value);
  if (hex) return [0, 2, 4].map(i => parseInt(hex[1]!.slice(i, i + 2), 16)) as RGB;
  const rgb = /^rgb\((\d+) (\d+) (\d+) \/ (\d+)%\)$/.exec(value);
  if (!rgb) throw new Error(`Unsupported color ${value}`);
  const alpha = Number(rgb[4]) / 100;
  return [1, 2, 3].map((i, k) => Number(rgb[i]) * alpha + over[k]! * (1 - alpha)) as RGB;
}
const luminance = ([r, g, b]: RGB) => [r, g, b].map(c => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }).reduce((sum, c, i) => sum + c * [0.2126, 0.7152, 0.0722][i]!, 0);
function contrast(tokens: Record<string, string>, fg: string, bg: string): number {
  const back = parse(tokens[bg]!, [255, 255, 255]), front = parse(tokens[fg]!, back);
  const [a, b] = [luminance(front), luminance(back)].sort((x, y) => y - x);
  return (a! + 0.05) / (b! + 0.05);
}

const text: [string, string][] = [["ink", "canvas"], ["ink", "surface"], ["muted", "canvas"], ["muted", "surface"], ["faint", "canvas"], ["faint", "surface"], ["accent-ink", "surface"], ["accent-ink", "canvas"], ["danger", "surface"], ["on-accent", "accent"]];
const controls: [string, string][] = [["control-line", "surface"], ["control-line", "fill"], ["control-off", "surface"], ["surface", "control-off"], ["accent", "surface"]];

for (const [theme, tokens] of [["light", light], ["dark", dark]] as const) {
  test(`${theme} text tokens reach 4.5:1`, () => {
    for (const [fg, bg] of text) assert.ok(contrast(tokens, fg, bg) >= 4.5, `${theme} --${fg} on --${bg}: ${contrast(tokens, fg, bg).toFixed(2)}:1`);
  });
  test(`${theme} control tokens reach 3:1`, () => {
    for (const [fg, bg] of controls) assert.ok(contrast(tokens, fg, bg) >= 3, `${theme} --${fg} against --${bg}: ${contrast(tokens, fg, bg).toFixed(2)}:1`);
  });
}
