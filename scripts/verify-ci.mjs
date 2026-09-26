import { closeSync, mkdirSync, openSync, readdirSync, readFileSync, rmSync } from "node:fs";
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

// CI 任务每次都是全新浏览器档案；本地重放必须一致，否则自适应脚本会
// 随历史状态漂移（继续/翻译按钮、批处理计数、恢复断言）。
for (const entry of readdirSync(path.join(root, "scripts"))) {
  if (entry.startsWith(".pw-profile-")) {
    rmSync(path.join(root, "scripts", entry), { recursive: true, force: true });
  }
}

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

async function waitForServer(url, child, logPath) {
  const deadline = Date.now() + 30_000;
  let stable = 0;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`dev server exited before becoming ready: ${url}`);
    }
    // A leftover listener on the fixed port would answer fetch() while our own
    // child dies on the bind conflict. Never trust a response that is not
    // backed by a stably running child.
    if (readFileSync(logPath, "utf8").includes("is already in use")) {
      throw new Error(`dev server port already in use (stale listener?): ${url}`);
    }
    let ok = false;
    try {
      ok = (await fetch(url)).ok;
    } catch {
      // Dev server is still starting.
    }
    stable = ok ? stable + 250 : 0;
    if (stable >= 2_000) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`dev server did not become ready: ${url}`);
}

async function stopServer(child) {
  liveServers.delete(child);
  if (child.exitCode !== null || child.signalCode !== null) return;
  // vp 可能留下子进程；按进程组终止，防止孤儿继续占用固定端口。
  const signal = (name) => {
    try {
      process.kill(-child.pid, name);
    } catch {
      child.kill(name);
    }
  };
  signal("SIGTERM");
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, 5_000)),
  ]);
  if (child.exitCode === null && child.signalCode === null) {
    signal("SIGKILL");
    await Promise.race([
      new Promise((resolve) => child.once("exit", resolve)),
      new Promise((resolve) => setTimeout(resolve, 2_000)),
    ]);
  }
}

async function withServer({ name, app, url, checks }) {
  const logPath = path.join(shots, `${name}-server.log`);
  const log = openSync(logPath, "w");
  const child = spawn(vp, ["-C", app, "dev", "--host", "127.0.0.1"], {
    cwd: root,
    env: process.env,
    stdio: ["ignore", log, log],
    detached: true,
  });
  liveServers.add(child);
  try {
    await waitForServer(url, child, logPath);
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
    "scripts/verify-general-agent-chat.mjs",
    "scripts/verify-knowledge-agent-writes.mjs",
    "scripts/verify-agent-conversations.mjs",
    "scripts/verify-credentials.mjs",
    "scripts/verify-shell-architecture.mjs",
    "scripts/verify-persistence.mjs",
    "scripts/verify-quant-lab.mjs",
    ...liveMarketChecks,
    "scripts/verify-manga-studio.mjs",
    "scripts/verify-document-studio.mjs",
    "scripts/verify-data-studio.mjs",
    "scripts/verify-reader-studio.mjs",
    "scripts/verify-reader-capture.mjs",
    "scripts/verify-reader-large-txt.mjs",
    "scripts/verify-reader-content.mjs",
    "scripts/verify-reader-mobile.mjs",
    "scripts/verify-reader-alignment.mjs",
    "scripts/verify-reader-typography.mjs",
    "scripts/verify-reader-pagination.mjs",
    "scripts/verify-reader-txt-pagination.mjs",
    "scripts/verify-reader-txt-flow.mjs",
    "scripts/verify-reader-focus.mjs",
    "scripts/verify-reader-page-height.mjs",
    "scripts/verify-reader-page-turn.mjs",
    "scripts/verify-reader-tools.mjs",
    "scripts/verify-reader-comics.mjs",
    "scripts/verify-storage-cleanup.mjs",
    "scripts/verify-global-search.mjs",
    "scripts/verify-knowledge.mjs",
    "scripts/verify-knowledge-workbench.mjs",
    "scripts/verify-knowledge-change-plan.mjs",
    "scripts/verify-knowledge-paths.mjs",
    "scripts/verify-knowledge-dialogs.mjs",
    "scripts/verify-theme.mjs",
    "scripts/verify-background.mjs",
    "scripts/verify-knowledge-restore.mjs",
    "scripts/verify-research.mjs",
    "scripts/verify-research-backup.mjs",
    "scripts/verify-research-search.mjs",
    "scripts/verify-research-package.mjs",
    "scripts/verify-research-recovery.mjs",
    "scripts/verify-research-import-staging.mjs",
    "scripts/verify-research-volumes.mjs",
    "scripts/verify-research-stream.mjs",
    "scripts/verify-research-task.mjs",
    "scripts/verify-research-package-cancel.mjs",
    "scripts/verify-accessibility.mjs",
    "scripts/verify-responsive.mjs",
    "scripts/verify-runtime-lifecycle.mjs",
  ],
});

console.log("browser CI verification PASSED");
