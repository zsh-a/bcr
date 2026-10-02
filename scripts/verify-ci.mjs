import {
  appendFileSync,
  closeSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import {
  browserGroupNames,
  parseBrowserOptions,
  selectBrowserGroups,
} from "./lib/browser-suites.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const shots = path.join(root, "scripts", "shots");
const vp = path.join(root, "node_modules", ".bin", "vp");
const liveProcesses = new Set();
const options = parseBrowserOptions(process.argv.slice(2));
const groups = selectBrowserGroups({
  ...options,
  liveMarkets: process.env.BCR_VERIFY_LIVE_MARKETS === "1",
});

if (options.list) {
  console.log(JSON.stringify(groups, null, 2));
} else {
  await verify();
}

function signalProcess(child, signal) {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
  // Terminate the process group, including dev-server/browser descendants.
  try {
    process.kill(-child.pid, signal);
  } catch {
    child.kill(signal);
  }
}

async function stopProcess(child) {
  signalProcess(child, "SIGTERM");
  if (child.exitCode === null && child.signalCode === null) {
    let timer;
    await Promise.race([
      new Promise((resolve) => child.once("exit", resolve)),
      new Promise((resolve) => {
        timer = setTimeout(resolve, 5_000);
      }),
    ]);
    clearTimeout(timer);
    signalProcess(child, "SIGKILL");
  }
  liveProcesses.delete(child);
}

function runCheck(check, env, group, timings) {
  return new Promise((resolve, reject) => {
    const name = path.basename(check, ".mjs");
    const logPath = path.join(shots, `${group}-${name}.log`);
    const log = openSync(logPath, "w");
    const started = Date.now();
    const child = spawn(process.execPath, [path.join(root, check)], {
      cwd: root,
      env: { ...process.env, ...env },
      stdio: ["ignore", log, log],
      detached: true,
    });
    liveProcesses.add(child);
    child.once("error", reject);
    child.once("close", (code, signal) => {
      liveProcesses.delete(child);
      closeSync(log);
      const seconds = (Date.now() - started) / 1_000;
      timings.push({ check: name, seconds, passed: code === 0 });
      console.log(`[${group}] ${code === 0 ? "PASS" : "FAIL"} ${name} (${seconds.toFixed(1)}s)`);
      if (code === 0) resolve();
      else {
        console.error(readFileSync(logPath, "utf8").split("\n").slice(-60).join("\n"));
        reject(new Error(`${check} exited with ${code ?? signal}. Log: ${logPath}`));
      }
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
    // A different listener must never satisfy this server's readiness check.
    if (readFileSync(logPath, "utf8").includes("is already in use")) {
      throw new Error(`dev server port already in use: ${url}`);
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

async function withServer({ group, app, port, checks, timings }) {
  const url = `http://127.0.0.1:${port}${app === "studio" ? "/studio" : ""}`;
  const logPath = path.join(shots, `${group}-${app}-server.log`);
  const log = openSync(logPath, "w");
  // Each group owns its profile. Never clear unrelated local or parallel runs.
  const profile = mkdtempSync(path.join(root, "scripts", `.pw-profile-ci-${group}-${app}-`));
  const profileName = path.basename(profile).slice(".pw-profile-".length);
  const child = spawn(
    vp,
    [
      "-C",
      `apps/${app === "studio" ? "studio" : "media-studio"}`,
      "dev",
      "--host",
      "127.0.0.1",
      "--port",
      String(port),
    ],
    {
      cwd: root,
      env: process.env,
      stdio: ["ignore", log, log],
      detached: true,
    },
  );
  liveProcesses.add(child);
  try {
    await once(child, "spawn");
    await waitForServer(url, child, logPath);
    for (const { script } of checks) {
      await runCheck(script, { BASE_URL: url, BCR_VERIFY_PROFILE: profileName }, group, timings);
    }
  } finally {
    await stopProcess(child);
    closeSync(log);
    rmSync(profile, { recursive: true, force: true });
  }
}

async function verify() {
  mkdirSync(shots, { recursive: true });
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.once(signal, () => {
      for (const child of liveProcesses) signalProcess(child, "SIGTERM");
      process.exitCode = 1;
    });
  }
  const started = Date.now();
  console.log(
    `Browser suite: ${options.suite}; ${groups.length} parallel groups; ${groups.reduce((count, group) => count + group.checks.length, 0)} checks`,
  );
  const results = await Promise.allSettled(
    groups.map(async ({ name, checks }) => {
      const timings = [];
      try {
        for (const app of ["media", "studio"]) {
          const appChecks = checks.filter((check) => check.app === app);
          if (!appChecks.length) continue;
          const port =
            app === "media"
              ? Number(process.env.BCR_VERIFY_MEDIA_PORT ?? 5180)
              : Number(process.env.BCR_VERIFY_STUDIO_PORT ?? 5199) +
                browserGroupNames.indexOf(name);
          await withServer({ group: name, app, port, checks: appChecks, timings });
        }
      } finally {
        const summary = [
          `### Browser ${options.suite}: ${name}`,
          "",
          "| Check | Seconds | Result |",
          "| --- | ---: | --- |",
          ...timings.map(
            ({ check, seconds, passed }) =>
              `| ${check} | ${seconds.toFixed(1)} | ${passed ? "PASS" : "FAIL"} |`,
          ),
          "",
        ].join("\n");
        appendFileSync(path.join(shots, `${name}-timings.md`), summary);
        if (process.env.GITHUB_STEP_SUMMARY)
          appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
      }
    }),
  );
  const failures = results.filter((result) => result.status === "rejected");
  for (const failure of failures) console.error(failure.reason);
  console.log(
    `Browser verification ${failures.length ? "FAILED" : "PASSED"} (${((Date.now() - started) / 1_000).toFixed(1)}s)`,
  );
  if (failures.length) process.exitCode = 1;
}
