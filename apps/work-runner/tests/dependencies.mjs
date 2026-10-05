/** Explicit slow check: frozen standalone dependencies, full-duration encoding, and portable source archives. */
import assert from "node:assert/strict";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { chromium } from "playwright";
import { Projects } from "../src/projects.ts";
import { Jobs } from "../src/jobs.ts";

const temp = mkdtempSync(join(tmpdir(), "bcr-runner-dependencies-"));
const root = join(temp, "project");
cpSync(resolve("apps/work-runner/starter"), root, { recursive: true });
assert(!existsSync(join(root, "node_modules")));
process.env.BCR_RUNNER_BROWSER = chromium.executablePath();
const projects = new Projects(root, join(temp, "state")),
  jobs = new Jobs(projects, "dependency-test");
try {
  const work = projects.read("starter");
  const wait = async (job) => {
    const deadline = Date.now() + 600000;
    while (["queued", "running"].includes(job.status) && Date.now() < deadline)
      await Bun.sleep(250);
    assert.equal(job.status, "succeeded", JSON.stringify(job));
    return join(jobs.directory(job.id), "outputs");
  };
  const input = { id: "starter", revision: work.revision, target: "vertical" };
  const video = jobs.start({
    ...input,
    kind: "video",
    profile: "draft",
    scale: 0.25,
    requestId: "full-video",
  });
  const directory = await wait(video);
  cpSync(join(directory, "video.mp4"), "/tmp/bcr-runner-full-30s.mp4");
  assert(
    !existsSync(join(root, "node_modules")),
    "installation must happen in job snapshots, not the mutable project",
  );
  console.log("PASS: standalone frozen bun.lock installation and full 30-second H.264 export");
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: () => new Response(Bun.file(join(directory, "video.mp4"))),
  });
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent("<video muted></video>");
    const playback = await page.evaluate(async (url) => {
      const video = document.querySelector("video");
      video.src = url;
      await new Promise((resolve, reject) => {
        video.onloadedmetadata = resolve;
        video.onerror = () => reject(new Error(video.error?.message));
      });
      const result = {
        duration: video.duration,
        width: video.videoWidth,
        height: video.videoHeight,
      };
      video.playbackRate = 8;
      await video.play();
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("Full playback timed out")), 30000);
        video.onended = () => {
          clearTimeout(timeout);
          resolve();
        };
        video.onerror = () => {
          clearTimeout(timeout);
          reject(new Error(video.error?.message));
        };
      });
      return result;
    }, `http://127.0.0.1:${server.port}/video.mp4`);
    // AAC packet padding can extend container duration by less than one video frame.
    assert(Math.abs(playback.duration - 30) < 1 / 30);
    assert.equal(playback.width, 270);
    assert.equal(playback.height, 480);
    console.log("PASS: all 30 seconds played to completion in Chromium");
  } finally {
    await browser.close();
    await server.stop(true);
  }
  const archive = await wait(jobs.start({ ...input, kind: "archive", requestId: "archive" }));
  const restored = join(temp, "restored");
  await new Bun.Archive(readFileSync(join(archive, "source.tar.gz"))).extract(restored);
  const restoredProjects = new Projects(restored, join(temp, "restored-state"));
  assert.equal(restoredProjects.read("starter").revision, work.revision);
  console.log("PASS: archive restored into a new directory with the identical source revision");
} finally {
  await jobs.close();
  rmSync(temp, { recursive: true, force: true });
}
