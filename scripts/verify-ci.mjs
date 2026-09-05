import { closeSync, mkdirSync, openSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { spawn } from "node:child_process";

const root = fileURLToPath(new URL("../", import.meta.url));
const shots = path.join(root, "scripts", "shots");
const vp = path.join(root, "node_modules", ".bin", "vp");
const liveServers = new Set();
const liveMarketChecks =
  process.env.BCR_VERIFY_LIVE_MARKETS === "1" ? ["scripts/verify-market-atlas.mjs"] : [];
mkdirSync(shots, { recursive: true });

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: root,
      env: { ...process.env, ...options.env },
      stdio: options.stdio ?? "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(" ")} exited with ${code ?? signal}`));
    });
  });
}

async function waitForServer(url, child) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`dev server exited before becoming ready: ${url}`);
    }
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Dev server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`dev server did not become ready: ${url}`);
}

async function stopServer(child) {
  liveServers.delete(child);
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    new Promise((resolve) =>
      setTimeout(() => {
        child.kill("SIGKILL");
        resolve();
      }, 5_000),
    ),
  ]);
}

async function withServer({ name, app, url, checks }) {
  const log = openSync(path.join(shots, `${name}-server.log`), "w");
  const child = spawn(vp, ["-C", app, "dev", "--host", "127.0.0.1"], {
    cwd: root,
    env: process.env,
    stdio: ["ignore", log, log],
  });
  liveServers.add(child);
  try {
    await waitForServer(url, child);
    for (const check of checks) {
      await run(process.execPath, [path.join(root, check)], { env: { BASE_URL: url } });
    }
  } finally {
    await stopServer(child);
    closeSync(log);
  }
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => {
    for (const child of liveServers) child.kill("SIGTERM");
    process.exitCode = 1;
  });
}

await withServer({
  name: "media",
  app: "apps/media-studio",
  url: "http://127.0.0.1:5180",
  checks: ["scripts/verify-media-studio.mjs", "scripts/verify-windowed-asr.mjs"],
});

await withServer({
  name: "studio",
  app: "apps/studio",
  url: "http://127.0.0.1:5199/studio",
  checks: [
    "scripts/verify-persistence.mjs",
    "scripts/verify-quant-lab.mjs",
    ...liveMarketChecks,
    "scripts/verify-manga-studio.mjs",
    "scripts/verify-document-studio.mjs",
    "scripts/verify-data-studio.mjs",
    "scripts/verify-reader-studio.mjs",
    "scripts/verify-storage-cleanup.mjs",
    "scripts/verify-global-search.mjs",
    "scripts/verify-accessibility.mjs",
    "scripts/verify-runtime-lifecycle.mjs",
  ],
});

console.log("browser CI verification PASSED");
