/** Actual shared-engine acceptance: immutable input, frozen dependencies, Player and AV1. */
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "playwright";

const directory = mkdtempSync(join(tmpdir(), "bcr-engine-acceptance-"));
const root = join(directory, "works");
mkdirSync(root);
process.env.BCR_WORK_ROOT = root;
process.env.BCR_WORK_STATE = join(directory, "engine-state");
process.env.BCR_WORK_CACHE = join(directory, "cache");
process.env.BCR_WORK_BROWSER ??= "/usr/bin/chromium";
writeFileSync(
  join(root, "workspace.json"),
  JSON.stringify({
    version: 1,
    cacheBudgetGiB: 8,
    projects: [{ id: "engine-work", role: "active" }],
  }),
);
const { createProject, gc } = await import("@bcr/work-engine");
const { Projects } = await import("../src/projects.ts");
const { startRunner } = await import("../src/server.ts");
const workDirectory = join(root, "engine-work");
let runner;
let browser;

async function command(args, cwd = workDirectory) {
  const child = Bun.spawn(args, { cwd, env: { ...process.env }, stdout: "pipe", stderr: "pipe" });
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  assert.equal(code, 0, `${args[0]}: ${stderr}\n${stdout}`);
  return stdout;
}

try {
  await createProject(workDirectory, "engine-work", { install: false });
  await command([process.execPath, "install", "--lockfile-only", "--ignore-scripts"]);
  assert(!existsSync(join(workDirectory, "node_modules")));
  const definition = JSON.parse(readFileSync(join(workDirectory, "work.json"), "utf8"));
  definition.targets = [
    {
      id: "main",
      runtime: "remotion",
      entry: "src/Scene.tsx",
      exportName: "Scene",
      width: 320,
      height: 180,
      fps: 30,
      durationInFrames: 12,
      propsFile: "data.json",
      parameters: [{ key: "amount", label: "Amount", type: "number", min: 0, max: 10 }],
    },
  ];
  writeFileSync(join(workDirectory, "work.json"), JSON.stringify(definition));
  writeFileSync(join(workDirectory, "data.json"), JSON.stringify({ amount: 3 }));
  writeFileSync(
    join(workDirectory, "src/Scene.tsx"),
    `
import React from 'react';
import {AbsoluteFill, Audio, staticFile, useCurrentFrame} from 'remotion';
export function Scene({amount}) {
  const frame = useCurrentFrame();
  return <AbsoluteFill style={{background:'#eeeae1',fontSize:36,padding:16}}>
    Amount {amount} · Frame {frame}<Audio src={staticFile('audio/tone.wav')}/>
  </AbsoluteFill>;
}
`,
  );
  // This independent generic Work exercises embedded audio, rather than declaring a measured narrator.
  writeFileSync(
    join(workDirectory, "production.json"),
    JSON.stringify({
      version: 1,
      privateAssets: ["audio/reference.wav", "audio/private.wav"],
      targets: {},
    }),
  );
  writeFileSync(join(workDirectory, "public/audio/reference.wav"), "private reference fixture");
  writeFileSync(join(workDirectory, "public/audio/private.wav"), "private additional fixture");
  await command([
    "ffmpeg",
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:sample_rate=48000:duration=0.4",
    join(workDirectory, "public/audio/tone.wav"),
  ]);
  const token = "engine-acceptance-token-".repeat(3);
  const origin = "http://localhost:5199";
  runner = startRunner({ root, state: join(directory, "runner-state"), token, origin, port: 0 });
  const api = `http://127.0.0.1:${runner.api.port}`;
  const rpc = async (operation, input) => {
    const response = await fetch(`${api}/rpc`, {
      method: "POST",
      headers: {
        Origin: origin,
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ op: operation, input }),
    });
    assert(response.ok, await response.clone().text());
    const value = await response.json();
    return value.result ?? value;
  };
  const project = runner.projects.read("engine-work");
  const wait = async (job) => {
    const deadline = Date.now() + 180000;
    while (["queued", "running"].includes(job.status) && Date.now() < deadline) {
      await Bun.sleep(100);
      job = runner.jobs.get(job.id);
    }
    assert.equal(job.status, "succeeded", JSON.stringify(job));
    assert(!existsSync(join(runner.jobs.directory(job.id), "project")));
    assert(!existsSync(join(runner.jobs.directory(job.id), "bundle")));
    return job;
  };
  const submit = async (kind, options = {}) =>
    wait(
      await rpc("render", {
        id: project.ref.id,
        revision: project.revision,
        target: "main",
        kind,
        requestId: crypto.randomUUID(),
        ...options,
      }),
    );
  const preview = await submit("preview");
  const previewInfo = await rpc("preview", { id: preview.id });
  const previewBase = new URL(".", previewInfo.url);
  assert.equal((await fetch(new URL("public/audio/reference.wav", previewBase))).status, 404);
  assert.equal((await fetch(new URL("public/audio/private.wav", previewBase))).status, 404);
  assert.equal((await fetch(new URL("public/audio/tone.wav", previewBase))).status, 200);
  assert(!existsSync(join(runner.jobs.directory(preview.id), "site/public")));
  browser = await chromium.launch({ executablePath: process.env.BCR_WORK_BROWSER, headless: true });
  const page = await browser.newPage();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto(previewInfo.url);
  await page.waitForFunction(() => document.body.innerText.includes("Amount 3"));
  const controlled = await page.evaluate(async () => {
    const channel = new MessageChannel();
    const messages = [];
    channel.port1.onmessage = ({ data }) => messages.push(data);
    window.postMessage("bcr-work-connect", location.origin, [channel.port2]);
    const waitFor = async (test) => {
      const deadline = Date.now() + 5000;
      while (!messages.some(test) && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      if (!messages.some(test)) {
        throw new Error("MessagePort response timed out");
      }
    };
    await waitFor((message) => message.type === "ready");
    channel.port1.postMessage({ id: "seek", action: "seek", frame: 3 });
    await waitFor((message) => message.type === "result" && message.id === "seek");
    channel.port1.postMessage({ id: "parameters", action: "parameters", values: { amount: 5 } });
    await waitFor((message) => message.type === "result" && message.id === "parameters");
    const result = messages.find((message) => message.id === "parameters");
    channel.port1.close();
    return result;
  });
  assert(!controlled.error, controlled.error);
  assert(controlled.result.text.includes("Amount 5"));
  assert.deepEqual(pageErrors, []);
  const capture = await submit("capture", { frames: [0] });
  assert.equal(capture.outputs[0].name, "frame-0.png");
  const captureDirectory = join(runner.jobs.directory(capture.id), "outputs");
  const report = JSON.parse(readFileSync(join(captureDirectory, "frame-0.png.json"), "utf8"));
  const cliOutput = await command(
    [
      process.execPath,
      resolve("packages/work-engine/src/cli.ts"),
      "--root",
      root,
      "capture",
      "engine-work",
      "--frame",
      "0",
      "--output",
      join(directory, "cli.png"),
    ],
    resolve("."),
  );
  const cliReport = JSON.parse(readFileSync(join(directory, "cli.png.json"), "utf8"));
  assert(cliOutput.includes("bundle cache hit"), cliOutput);
  assert.equal(cliReport.input.key, report.input.key);
  assert.equal(cliReport.sha256, report.sha256);
  const videoOptions = process.env.BCR_ENGINE_TEST_CPU
    ? {
        encoder: "libaom-av1",
        cpuReason: "Explicit acceptance run on a host without NVIDIA",
        cq: 40,
      }
    : {};
  const video = await submit("video", videoOptions);
  const videoReport = JSON.parse(
    readFileSync(join(runner.jobs.directory(video.id), "outputs/video.mp4.json"), "utf8"),
  );
  assert.equal(
    videoReport.media.streams.find((stream) => stream.codec_type === "video").codec_name,
    "av1",
  );
  assert.equal(
    videoReport.media.streams.find((stream) => stream.codec_type === "audio").sample_rate,
    "48000",
  );
  assert.equal(videoReport.frames, 12);
  const decoded = join(directory, "decoded.pcm");
  await command([
    "ffmpeg",
    "-v",
    "error",
    "-i",
    join(runner.jobs.directory(video.id), "outputs/video.mp4"),
    "-vn",
    "-f",
    "s16le",
    "-ac",
    "1",
    "-ar",
    "48000",
    decoded,
  ]);
  const samples = readFileSync(decoded);
  let peak = 0;
  for (let offset = 0; offset + 1 < samples.length; offset += 2) {
    peak = Math.max(peak, Math.abs(samples.readInt16LE(offset)));
  }
  assert(peak > 1000, "embedded audio must remain audible in the AV1 output");
  const again = await submit("video", { ...videoOptions, cq: 21 });
  assert(
    JSON.parse(
      readFileSync(join(runner.jobs.directory(again.id), "outputs/video.mp4.json"), "utf8"),
    ).frameCacheHit,
  );
  const archive = await submit("archive");
  const restored = join(directory, "restored");
  await new Bun.Archive(
    readFileSync(join(runner.jobs.directory(archive.id), "outputs/source.tar.gz")),
  ).extract(restored);
  assert.equal(
    new Projects(restored, join(directory, "restored-state")).read("engine-work").revision,
    project.revision,
  );
  assert(
    !existsSync(join(workDirectory, "node_modules")),
    "snapshot execution must not install into editable sources",
  );
  await gc(true, 0);
  assert.equal(
    (await fetch(new URL("public/audio/tone.wav", previewBase))).status,
    200,
    "preview survives cache collection",
  );
  console.log(
    JSON.stringify({
      passed: true,
      backend: "shared work-engine",
      cliAndRunnerSameIdentity: true,
      privatePreviewAssetBlocked: true,
      previewSeekAndParameters: true,
      av1Frames: 12,
      frameCacheReused: true,
      archiveRevisionPreserved: true,
      previewSurvivesGC: true,
    }),
  );
} finally {
  await browser?.close();
  await runner?.close();
  rmSync(directory, { recursive: true, force: true });
}
