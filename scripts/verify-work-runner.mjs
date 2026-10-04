import { spawnSync } from "node:child_process";
const result = spawnSync("bun", ["apps/work-runner/tests/browser.mjs"], {
  stdio: "inherit",
  timeout: 240000,
});
if (result.error) console.error(result.error);
process.exitCode = result.status ?? 1;
