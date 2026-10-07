import { spawnSync } from "node:child_process";
for (const suite of ["engine", "review-browser"]) {
  const result = spawnSync("bun", [`apps/work-runner/tests/${suite}.mjs`], {
    stdio: "inherit",
    timeout: 240000,
  });
  if (result.error) console.error(result.error);
  if (result.status !== 0) {
    process.exitCode = result.status ?? 1;
    break;
  }
}
