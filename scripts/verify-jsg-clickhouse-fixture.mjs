import { spawn } from "node:child_process";
import { once } from "node:events";
import { repoRoot } from "./lib/browser.mjs";
const port = process.env.JSG_FIXTURE_PORT ?? "8126";
const source = `http://127.0.0.1:${port}/`;
const server = spawn("bun", ["scripts/serve-jsg-http-fixture.ts"], {
  cwd: repoRoot,
  stdio: "inherit",
  env: { ...process.env, JSG_FIXTURE_PORT: port },
});
try {
  let ready = false;
  for (let i = 0; i < 100; i++) {
    if (server.exitCode !== null) throw new Error("HTTP fixture failed to start");
    ready = await fetch(`${source}ping`)
      .then((r) => r.ok)
      .catch(() => false);
    if (ready) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (!ready) throw new Error("HTTP fixture startup timed out");
  const verify = spawn(process.execPath, ["scripts/verify-jsg-clickhouse.mjs"], {
    cwd: repoRoot,
    stdio: "inherit",
    env: {
      ...process.env,
      CLICKHOUSE_TEST_URL: source,
      CLICKHOUSE_DATABASE: "stock_data",
      CLICKHOUSE_USER: "fixture",
      CLICKHOUSE_PASSWORD: "",
      JSG_TEST_START: "2024-02-13",
      JSG_TEST_END: "2024-08-30",
      JSG_EXPECT_NAMES: "1",
    },
  });
  const [code] = await once(verify, "exit");
  if (code !== 0) throw new Error(`HTTP fixture browser verification exited ${code}`);
} finally {
  server.kill("SIGTERM");
  if (server.exitCode === null) await once(server, "exit");
}
