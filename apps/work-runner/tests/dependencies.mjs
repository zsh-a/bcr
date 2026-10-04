/** Explicit slow check: frozen standalone dependencies, full-duration encoding, and portable source archives. */
import assert from "node:assert/strict";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { chromium } from "playwright";
import { Projects } from "../src/projects.ts";
import { Jobs } from "../src/jobs.ts";

const temp = mkdtempSync(join(tmpdir(), "bcr-runner-dependencies-"));
const root = join(temp, "project");
cpSync(resolve("apps/work-runner/example"), root, { recursive: true });
const manifest = {
  private: true,
  type: "module",
  dependencies: {
    remotion: "4.0.532",
    "@remotion/player": "4.0.532",
    react: JSON.parse(
      readFileSync(resolve("apps/work-runner/node_modules/react/package.json"), "utf8"),
    ).version,
    "react-dom": JSON.parse(
      readFileSync(resolve("apps/work-runner/node_modules/react-dom/package.json"), "utf8"),
    ).version,
  },
};
writeFileSync(join(root, "package.json"), JSON.stringify(manifest));
const install = Bun.spawn([process.execPath, "install", "--lockfile-only", "--ignore-scripts"], {
  cwd: root,
  stdout: "ignore",
  stderr: "pipe",
});
assert.equal(await install.exited, 0, await new Response(install.stderr).text());
assert(!existsSync(join(root, "node_modules")));
process.env.BCR_RUNNER_BROWSER = chromium.executablePath();
const projects = new Projects(root, join(temp, "state")),
  jobs = new Jobs(projects, "dependency-test");
try {
  const work = projects.read("gym-card");
  const wait = async (job) => {
    const deadline = Date.now() + 240000;
    while (["queued", "running"].includes(job.status) && Date.now() < deadline)
      await Bun.sleep(250);
    assert.equal(job.status, "succeeded", JSON.stringify(job));
    return join(jobs.directory(job.id), "outputs");
  };
  const input = { id: "gym-card", revision: work.revision, target: "vertical" };
  const video = jobs.start({ ...input, kind: "video", scale: 0.25, requestId: "full-video" });
  const directory = await wait(video);
  cpSync(join(directory, "video.mp4"), "/tmp/bcr-runner-full-60s.mp4");
  assert(
    !existsSync(join(root, "node_modules")),
    "installation must happen in job snapshots, not the mutable project",
  );
  console.log("PASS: standalone frozen bun.lock installation and full 60-second H.264 export");
  const archive = await wait(jobs.start({ ...input, kind: "archive", requestId: "archive" }));
  const restored = join(temp, "restored");
  await new Bun.Archive(readFileSync(join(archive, "source.tar.gz"))).extract(restored);
  const restoredProjects = new Projects(restored, join(temp, "restored-state"));
  assert.equal(restoredProjects.read("gym-card").revision, work.revision);
  console.log("PASS: archive restored into a new directory with the identical source revision");
} finally {
  await jobs.close();
  rmSync(temp, { recursive: true, force: true });
}
