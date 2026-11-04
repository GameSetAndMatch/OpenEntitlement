import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../../", import.meta.url));
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
for (const [directory, args] of [
  ["sdk-js", ["run", "lint"]],
  ["console", ["exec", "--prefix", "../sdk-js", "--", "eslint", "--config", "eslint.config.mjs", "."]],
  ["sdk-js", ["run", "typecheck"]],
  ["console", ["run", "typecheck"]],
  ["sdk-js", ["run", "check:dependencies"]],
  ["console", ["exec", "--prefix", "../sdk-js", "--", "knip", "--dependencies"]],
]) {
  const result = spawnSync(npm, args, { cwd: `${root}${directory}`, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
