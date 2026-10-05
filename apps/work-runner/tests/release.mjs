/** Release acceptance: install away from the workspace, no browser Bridge, real PNG/MP4. */
import assert from "node:assert/strict";
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { chromium } from "playwright";

const temp = mkdtempSync(join(tmpdir(), "bcr-runner-installed-"));
const config = join(temp, "connection.json");
const portable = process.argv.includes("--portable");
const env = {
  ...process.env,
  BCR_RUNNER_BROWSER: chromium.executablePath(),
  XDG_CACHE_HOME: join(temp, "cache"),
};
async function run(command, args, options = {}) {
  const process = Bun.spawn([command, ...args], {
    cwd: temp,
    env,
    stdout: "pipe",
    stderr: "pipe",
    ...options,
  });
  const [code, stdout, stderr] = await Promise.all([
    process.exited,
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
  ]);
  assert.equal(code, 0, `${args.join(" ")}\n${stderr}\n${stdout}`);
  return stdout.trim();
}
let executable, prefix;
let packageDir = join(temp, "package");
let client;
let transport;
try {
  if (portable) {
    const archive = resolve(
      `dist/work-runner/bcr-runner-${process.platform}-${process.arch}.tar.gz`,
    );
    await new Bun.Archive(readFileSync(archive)).extract(packageDir);
    executable = join(packageDir, "bin/bcr-runner");
    prefix = [];
    env.PATH = "/usr/bin:/bin"; // No ambient Bun/Node installation is needed by the launcher or workers.
  } else {
    const manifest = JSON.parse(readFileSync(resolve("apps/work-runner/package.json"), "utf8"));
    const archive = resolve(`dist/work-runner/bcr-work-runner-${manifest.version}.tgz`);
    writeFileSync(join(temp, "package.json"), '{"private":true}');
    await run(process.execPath, ["add", archive, "--ignore-scripts"]);
    packageDir = realpathSync(join(temp, "node_modules/@bcr/work-runner"));
    executable = process.execPath;
    prefix = [join(packageDir, "dist/cli.js")];
  }
  // Every installed dependency resolves within the release installation, never the monorepo.
  const installedModules = join(portable ? packageDir : temp, "node_modules");
  for (const entry of readdirSync(installedModules, { withFileTypes: true })) {
    const path = join(installedModules, entry.name);
    assert(realpathSync(path).startsWith(temp), `external dependency link: ${path}`);
  }
  const cli = async (...args) =>
    JSON.parse(await run(executable, [...prefix, ...args, "--config", config, "--json"]));
  assert.equal((await cli("version")).version, "0.2.0");
  await cli(
    "create",
    join(temp, "project"),
    "--id",
    "starter-work",
    "--title",
    "Starter Work",
  );
  const starter = await cli(
    "create",
    join(temp, "starter"),
    "--id",
    "starter-alt",
    "--title",
    "Starter Work",
  );
  assert.equal(starter.work.id, "starter-alt");
  assert.equal(starter.work.targets.length, 2);
  assert(!existsSync(join(packageDir, "src")));
  const start = await cli(
    "start",
    "--root",
    join(temp, "project"),
    "--state",
    join(temp, "state"),
    "--port",
    "0",
  );
  assert.equal((await cli("start")).instanceId, start.instanceId);
  assert.equal((await cli("status")).running, true);
  assert.equal((await cli("doctor")).worker, true);
  console.log(
    "PASS: standalone installation, background start/status/doctor, repeated start reuses service",
  );
  transport = new StdioClientTransport({
    command: executable,
    args: [...prefix, "mcp", "--config", config],
    cwd: temp,
    env,
  });
  client = new Client(
    { name: "runner-release-test", version: "1.0.0" },
    { versionNegotiation: { mode: "legacy" } },
  );
  await client.connect(transport);
  const names = (await client.listTools()).tools.map((t) => t.name);
  assert(names.includes("runner_render") && names.includes("runner_output"));
  const call = async (name, args = {}) => {
    const reply = await client.callTool({ name: `runner_${name}`, arguments: args });
    assert(!reply.isError, JSON.stringify(reply));
    return JSON.parse(reply.content[0].text);
  };
  const catalog = await call("catalog");
  assert.equal(catalog.format, "bcr-runner-1");
  assert.equal(catalog.version, "0.2.0");
  assert.equal(catalog.instanceId, start.instanceId);
  const pageCapture = await call("page_capture", {
    requestId: "release-page",
    source: { kind: "document", key: "release-test", html: "<h1>Portable page capture</h1>" },
    page: { path: "index.html", viewport: { width: 390, height: 844 } },
  });
  assert.equal(pageCapture.image.mime, "image/png");
  assert(pageCapture.elements.some((e) => e.text === "Portable page capture"));
  const pageImage = await client.callTool({
    name: "runner_page_image",
    arguments: { id: pageCapture.id },
  });
  assert(!pageImage.isError && pageImage.content.some((c) => c.type === "image"));
  await cli("page-image", pageCapture.id, "--output", join(temp, "page.png"));
  assert.equal(readFileSync(join(temp, "page.png")).readUInt32BE(16), 390);
  console.log("PASS: portable page worker, isolated Chromium screenshot and MCP image feedback");
  const work = await call("read", { id: "starter-work" });
  assert.equal(work.directory, join(temp, "project"));
  const request = { id: "starter-work", revision: work.revision, target: "vertical" };
  const capture = await call("render", {
    ...request,
    kind: "capture",
    scale: 0.25,
    profile: "draft",
    frames: [0, 360],
    requestId: "capture",
  });
  assert.equal(
    (
      await call("render", {
        ...request,
        kind: "capture",
        scale: 0.25,
        profile: "draft",
        frames: [0, 360],
        requestId: "capture",
      })
    ).id,
    capture.id,
  );
  // Ending the MCP session must not stop the task or the service.
  await client.close();
  client = undefined;
  const wait = async (id) => {
    const deadline = Date.now() + 120000;
    while (Date.now() < deadline) {
      const job = await cli("job", id);
      if (["queued", "running"].includes(job.status)) {
        await Bun.sleep(250);
        continue;
      }
      assert.equal(job.status, "succeeded", JSON.stringify(job));
      return job;
    }
    throw new Error("Job timed out");
  };
  await wait(capture.id);
  const png = join(temp, "frame.png");
  await cli("download", capture.id, "frame-360.png", "--output", png);
  assert.equal(readFileSync(png).subarray(1, 4).toString(), "PNG");
  transport = new StdioClientTransport({
    command: executable,
    args: [...prefix, "mcp", "--config", config],
    cwd: temp,
    env,
  });
  client = new Client(
    { name: "runner-release-test", version: "1.0.0" },
    { versionNegotiation: { mode: "auto" } },
  );
  await client.connect(transport);
  const image = await client.callTool({
    name: "runner_output",
    arguments: { id: capture.id, name: "frame-360.png", image: true },
  });
  assert(!image.isError && image.content.some((c) => c.type === "image"));
  const validation = await call("render", {
    ...request,
    kind: "validate",
    profile: "draft",
    requestId: "diagnostics",
  });
  await wait(validation.id);
  const report = await call("output", { id: validation.id, name: "diagnostics.json", text: true });
  const diagnostics = JSON.parse(report.text);
  assert.equal(diagnostics.sourceRevision, work.revision);
  assert.equal(diagnostics.fonts.length, 0);
  assert.deepEqual(diagnostics.errors, []);
  const invalidText = await client.callTool({
    name: "runner_output",
    arguments: { id: capture.id, name: "frame-360.png", text: true },
  });
  assert.equal(invalidText.isError, true);
  const reviews = await call("review_read", { id: "starter-work" });
  const submitted = await call("review_edit", {
    id: "starter-work",
    revision: reviews.revision,
    requestId: "review-submit",
    action: {
      kind: "submit",
      submissionId: "r1",
      sourceRevision: work.revision,
      target: "vertical",
      title: "首稿",
      summary: "首个可审阅版本。",
      jobIds: [capture.id],
      addresses: [],
    },
  });
  const commented = await call("review_edit", {
    id: "starter-work",
    revision: submitted.revision,
    requestId: "review-comment",
    action: {
      kind: "comment",
      feedbackId: "f1",
      submissionId: "r1",
      comment: "延迟结论。",
      anchor: { kind: "timeline", frame: 360 },
    },
  });
  assert.equal(commented.feedback[0].id, "f1");
  const changed = await call("parameters", {
    id: "starter-work",
    revision: work.revision,
    target: "vertical",
    requestId: "params",
    values: { value: 1800 },
  });
  assert.notEqual(changed.revision, work.revision);
  const stale = await client.callTool({
    name: "runner_parameters",
    arguments: {
      id: "starter-work",
      revision: work.revision,
      target: "vertical",
      requestId: "stale",
      values: { value: 2000 },
    },
  });
  assert.equal(stale.isError, true);
  console.log(
    "PASS: browser-independent STDIO MCP, PNG feedback, revision-checked edits, reviews; rendering survives MCP disconnect",
  );
  const video = await call("render", {
    ...request,
    kind: "video",
    scale: 0.25,
    profile: "draft",
    crf: 24,
    from: 0,
    to: 29,
    requestId: "video",
  });
  await wait(video.id);
  const mp4 = join(temp, "video.mp4");
  await cli("download", video.id, "video.mp4", "--output", mp4);
  assert.equal(readFileSync(mp4).subarray(4, 8).toString(), "ftyp");
  const preview = await call("render", { ...request, kind: "preview", requestId: "preview" });
  await wait(preview.id);
  const previewInfo = await call("preview", { id: preview.id });
  assert.notEqual(new URL(previewInfo.url).origin, start.url);
  const html = await fetch(previewInfo.url);
  assert.equal(html.status, 200);
  assert((await html.text()).includes("player.js"));
  const bundle = await fetch(new URL("player.js", previewInfo.url));
  assert.equal(bundle.status, 200);
  const archive = await call("render", { ...request, kind: "archive", requestId: "archive" });
  await wait(archive.id);
  console.log("PASS: relocated worker, isolated Remotion player, PNG, MP4 and source archive");
  await client.close();
  client = undefined;
  const interrupted = await cli("render", "starter-work", "--target", "vertical", "--scale", "0.25");
  await cli("stop");
  assert.equal((await cli("status")).running, false);
  const restarted = await cli("start");
  assert.notEqual(restarted.instanceId, start.instanceId);
  assert.equal((await cli("job", video.id)).status, "succeeded");
  assert.equal((await cli("job", interrupted.id)).status, "interrupted");
  client = new Client(
    { name: "runner-release-test", version: "1.0.0" },
    { versionNegotiation: { mode: "auto" } },
  );
  await client.connect(
    new StdioClientTransport({
      command: executable,
      args: [...prefix, "mcp", "--config", config],
      cwd: temp,
      env,
    }),
  );
  assert.equal((await call("review_read", { id: "starter-work" })).submissions.length, 1);
  await client.close();
  client = undefined;
  await cli("stop");
  cpSync(mp4, `/tmp/bcr-runner-${portable ? "portable" : "package"}-acceptance.mp4`);
  console.log("PASS: stop/restart retains jobs, outputs and reviews");
} finally {
  await client?.close();
  if (existsSync(config)) {
    const saved = JSON.parse(readFileSync(config, "utf8"));
    await fetch(`${saved.url}/shutdown`, {
      method: "POST",
      headers: { Authorization: `Bearer ${saved.token}` },
    }).catch(() => {});
    await Bun.sleep(300);
  }
  rmSync(temp, { recursive: true, force: true });
}
