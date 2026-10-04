/** Real container acceptance. No BCR repository is mounted into the container. */
import assert from "node:assert/strict";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
const temp = mkdtempSync(join(tmpdir(), "bcr-runner-docker-"));
const name = `bcr-runner-test-${crypto.randomUUID()}`;
const image = process.env.BCR_RUNNER_IMAGE ?? "bcr-work-runner:local";
const project = join(temp, "project"),
  data = join(temp, "data");
cpSync(resolve("dist/work-runner/package/example"), project, { recursive: true });
mkdirSync(data);
async function docker(...args) {
  const child = Bun.spawn(["docker", ...args], { stdout: "pipe", stderr: "pipe" });
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  assert.equal(code, 0, `docker ${args[0]}: ${stderr}`);
  return stdout.trim();
}
const ports = [0, 1].map(() =>
  Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response() }),
);
const api = `http://127.0.0.1:${ports[0].port}`,
  preview = `http://127.0.0.1:${ports[1].port}`;
const origin = "https://bcr.example.test";
try {
  await Promise.all(ports.map((p) => p.stop(true)));
  await docker(
    "run",
    "--detach",
    "--name",
    name,
    "--user",
    `${process.getuid()}:${process.getgid()}`,
    "--init",
    "-p",
    `${new URL(api).host}:5210`,
    "-p",
    `${new URL(preview).host}:5211`,
    "-v",
    `${project}:/works`,
    "-v",
    `${data}:/data`,
    image,
    "serve",
    "--root",
    "/works",
    "--state",
    "/data/state/runner",
    "--host",
    "0.0.0.0",
    "--port",
    "5210",
    "--preview-port",
    "5211",
    "--origin",
    origin,
    "--api-url",
    api,
    "--preview-url",
    preview,
  );
  const config = join(data, "config/bcr/work-runner.json");
  const deadline = Date.now() + 20000;
  while (!existsSync(config) && Date.now() < deadline) await Bun.sleep(100);
  assert(existsSync(config), await docker("logs", name));
  const { token } = JSON.parse(readFileSync(config, "utf8"));
  const rpc = async (op, input = {}) => {
    const response = await fetch(`${api}/rpc`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Origin: origin,
      },
      body: JSON.stringify({ op, input }),
    });
    assert.equal(response.status, 200, await response.clone().text());
    return response.json();
  };
  assert.equal((await fetch(`${api}/health`)).status, 401);
  assert.equal((await rpc("catalog")).version, "0.2.0");
  const work = await rpc("read", { id: "gym-card" });
  const base = { id: "gym-card", revision: work.revision, target: "vertical", scale: 0.25 };
  const wait = async (id) => {
    const deadline = Date.now() + 300000;
    while (Date.now() < deadline) {
      const job = await rpc("job", { id });
      if (["queued", "running"].includes(job.status)) {
        await Bun.sleep(500);
        continue;
      }
      assert.equal(job.status, "succeeded", JSON.stringify(job));
      return job;
    }
    throw new Error("Container rendering timed out");
  };
  for (const { kind, extra, output, marker, offset } of [
    {
      kind: "capture",
      extra: { frames: [360] },
      output: "frame-360.png",
      marker: "PNG",
      offset: 1,
    },
    { kind: "video", extra: { from: 0, to: 29 }, output: "video.mp4", marker: "ftyp", offset: 4 },
  ]) {
    const job = await rpc("render", { ...base, kind, requestId: kind, ...extra });
    await wait(job.id);
    const response = await fetch(`${api}/outputs/${job.id}/${output}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(response.status, 200);
    const bytes = Buffer.from(await response.arrayBuffer());
    assert.equal(bytes.subarray(offset, offset + marker.length).toString(), marker);
    console.log(
      `PASS: Docker ${output}, using only standalone package, user work directory and persistent /data`,
    );
  }
  const job = await rpc("render", { ...base, kind: "preview", requestId: "preview" });
  await wait(job.id);
  const info = await rpc("preview", { id: job.id });
  assert.equal(new URL(info.url).origin, preview);
  assert.equal((await fetch(info.url)).status, 200);
  const pending = await rpc("render", { ...base, kind: "video", requestId: "crash-recovery" });
  await docker("kill", "--signal", "KILL", name);
  await docker("start", name);
  const ready = Date.now() + 20000;
  let restarted = false;
  while (Date.now() < ready) {
    try {
      if ((await rpc("job", { id: job.id })).status === "succeeded") {
        restarted = true;
        break;
      }
    } catch {
      /* restarting */
    }
    await Bun.sleep(100);
  }
  assert(restarted);
  assert.equal((await rpc("job", { id: pending.id })).status, "interrupted");
  console.log(
    "PASS: separate preview origin and persisted jobs after abrupt container restart (stale PID lease)",
  );
} catch (error) {
  process.stderr.write(`${await docker("logs", name).catch(() => "")}\n`);
  throw error;
} finally {
  await docker("rm", "-f", name).catch(() => {});
  rmSync(temp, { recursive: true, force: true });
}
