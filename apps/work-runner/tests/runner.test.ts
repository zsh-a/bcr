import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Projects } from "../src/projects";
import { Jobs } from "../src/jobs";
import { startRunner } from "../src/server";
import { serviceOptions } from "../src/lifecycle";

const dirs: string[] = [];
const disposals: (() => void | Promise<void>)[] = [];
afterEach(async () => {
  for (const dispose of disposals.splice(0)) await dispose();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "bcr-runner-"));
  dirs.push(directory);
  const root = join(directory, "project"),
    state = join(directory, "state");
  mkdirSync(root);
  writeFileSync(
    join(root, "work.json"),
    JSON.stringify({
      format: "bcr-project-1",
      id: "test",
      title: "Test",
      targets: [
        { id: "page", runtime: "html", entry: "index.html" },
        {
          id: "movie",
          runtime: "remotion",
          entry: "Scene.tsx",
          width: 300,
          height: 200,
          fps: 30,
          durationInFrames: 60,
          propsFile: "data.json",
          parameters: [{ key: "price", label: "Price", type: "number", min: 1, max: 100 }],
        },
      ],
    }),
  );
  writeFileSync(join(root, "index.html"), "<h1>Original</h1>");
  writeFileSync(join(root, "Scene.tsx"), "export default () => null");
  writeFileSync(join(root, "data.json"), '{"price":10}');
  return { directory, root, state, projects: new Projects(root, state) };
}
test("changing the authorized root defaults to a separate state directory", () => {
  const { root, state, directory } = fixture();
  const saved = {
    url: "http://127.0.0.1:5210",
    token: "a".repeat(64),
    options: { root, state, origin: "http://localhost:5199" },
  };
  expect(serviceOptions({}, saved).state).toBe(state);
  const nextRoot = join(directory, "another-project");
  expect(serviceOptions({ root: nextRoot }, saved).state).not.toBe(state);
  expect(serviceOptions({ root: nextRoot, state }, saved).state).toBe(state);
});
test("snapshots pin bytes; reviews have independent revisions; stale parameters cannot overwrite", () => {
  const { projects, root } = fixture();
  const work = projects.read("test");
  projects.snapshot("test", work.revision);
  const before = projects.reviews("test");
  const review = {
    id: "note",
    revision: before.revision,
    requestId: "review",
    review: {
      id: "r1",
      sourceRevision: work.revision,
      target: "movie",
      frame: 12,
      comment: "delay",
      status: "open",
    },
  };
  expect(() => projects.review(review)).toThrow();
  const result = projects.review({ ...review, id: "test" });
  expect(projects.review({ ...review, id: "test" })).toEqual(result);
  expect(projects.read("test").revision).toBe(work.revision);
  const change = {
    id: "test",
    revision: work.revision,
    target: "movie",
    requestId: "change",
    values: { price: 20 },
  };
  const next = projects.parameters(change);
  expect(next.revision).not.toBe(work.revision);
  expect(projects.parameters(change)).toEqual(next);
  expect(() =>
    projects.parameters({ ...change, requestId: "stale", values: { price: 30 } }),
  ).toThrow("冲突");
  expect(projects.file("test", work.revision, "data.json").toString()).toBe('{"price":10}');
  expect(JSON.parse(readFileSync(join(root, "data.json"), "utf8")).price).toBe(20);
  expect(() => projects.review({ ...review, id: "test", requestId: "stale-review" })).toThrow(
    "冲突",
  );
  expect(() =>
    projects.review({
      ...review,
      id: "test",
      requestId: "invalid-frame",
      revision: result.revision,
      review: { ...review.review, frame: 60 },
    }),
  ).toThrow("帧号");
});
test("paths, symlinks, private files and parameter declarations are enforced", () => {
  const { root, directory, projects } = fixture();
  writeFileSync(join(root, ".env"), "SECRET=not-snapshotted");
  const work = projects.read("test");
  expect(work.files.some((f) => f.path === ".env")).toBe(false);
  expect(() => projects.file("test", work.revision, "../outside")).toThrow();
  expect(() =>
    projects.parameters({
      id: "test",
      revision: work.revision,
      target: "movie",
      requestId: "unknown",
      values: { undeclared: 3 },
    }),
  ).toThrow("参数无效");
  expect(() =>
    projects.parameters({
      id: "test",
      revision: work.revision,
      target: "movie",
      requestId: "range",
      values: { price: 1000 },
    }),
  ).toThrow("参数无效");
  writeFileSync(join(directory, "outside"), "secret");
  symlinkSync(join(directory, "outside"), join(root, "leak"));
  expect(() => projects.read("test")).toThrow("符号链接");
});
test("job requests are idempotent, cancellable and persist through restart", async () => {
  const { projects } = fixture();
  const jobs = new Jobs(projects, "engine-1");
  disposals.push(() => jobs.close());
  const request = {
    id: "test",
    target: "page",
    revision: projects.read("test").revision,
    kind: "preview",
    requestId: "task",
  };
  const job = jobs.start(request);
  expect(jobs.start(request).id).toBe(job.id);
  expect(() => jobs.start({ ...request, kind: "archive" })).toThrow("requestId");
  expect(jobs.cancel(job.id).status).toBe("cancelled");
  await jobs.close();
  const reopened = new Jobs(projects, "engine-1");
  disposals.push(() => reopened.close());
  expect(reopened.get(job.id).status).toBe("cancelled");
  const pending = reopened.start({ ...request, requestId: "pending" });
  await reopened.close();
  const restarted = new Jobs(projects, "engine-1");
  disposals.push(() => restarted.close());
  expect(restarted.get(pending.id).status).toBe("interrupted");
  expect(restarted.start(request).id).toBe(job.id);
  await Promise.resolve();
});
test("control API requires exact origin and bearer; HTML preview runs on a separate origin", async () => {
  const { root, state } = fixture();
  const token = "a".repeat(64),
    origin = "http://localhost:5199";
  const runner = startRunner({ root, state, token, origin, port: 0 });
  disposals.push(() => runner.close());
  const url = `http://127.0.0.1:${runner.api.port}`;
  const call = (op: string, input = {}, headers: Record<string, string> = {}) =>
    fetch(`${url}/rpc`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Origin: origin,
        ...headers,
      },
      body: JSON.stringify({ op, input }),
    });
  expect((await call("list", {}, { Authorization: "bad" })).status).toBe(401);
  expect((await call("list", {}, { Authorization: `Bearer ${"é".repeat(64)}` })).status).toBe(401);
  expect((await call("list", { unexpected: true })).status).toBe(400);
  expect((await call("list", {}, { Origin: "http://localhost:9999" })).status).toBe(403);
  const work = runner.projects.read("test");
  const result = await (
    await call("render", {
      id: "test",
      target: "page",
      revision: work.revision,
      kind: "preview",
      requestId: "html",
    })
  ).json();
  const deadline = Date.now() + 30000;
  while (["queued", "running"].includes(runner.jobs.get(result.id).status) && Date.now() < deadline)
    await Bun.sleep(100);
  expect(runner.jobs.get(result.id).status).toBe("succeeded");
  const preview = await (await call("preview", { id: result.id })).json();
  expect(new URL(preview.url).origin).not.toBe(url);
  const html = await fetch(preview.url);
  expect(html.headers.get("content-security-policy")).toContain("connect-src 'self'");
  expect(await html.text()).toContain("Original");
  expect((await call("list", {}, { Origin: new URL(preview.url).origin })).status).toBe(403);
}, 35000);

test("remote listeners require explicit separate origins and advertise proxy URLs", async () => {
  const { root, state } = fixture();
  const base = { root, state, token: "a".repeat(64), origin: "https://bcr.example.com", port: 0 };
  expect(() => startRunner({ ...base, host: "0.0.0.0" })).toThrow("api-url");
  expect(() => startRunner({ ...base, apiUrl: base.origin })).toThrow("不同来源");
  expect(() =>
    startRunner({
      ...base,
      apiUrl: "https://runner.example.com",
      previewUrl: "https://runner.example.com",
    }),
  ).toThrow("不同来源");
  const runner = startRunner({
    ...base,
    host: "0.0.0.0",
    apiUrl: "https://runner.example.com",
    previewUrl: "https://preview.example.com",
  });
  disposals.push(() => runner.close());
  expect(runner.url).toBe("https://runner.example.com");
  const local = `http://127.0.0.1:${runner.api.port}`;
  const response = await fetch(`${local}/health`, {
    headers: { Authorization: `Bearer ${base.token}`, Host: "runner.example.com" },
  });
  const catalog = await response.json();
  expect(catalog.version).toMatch(/^0\.2\.0/);
  expect(catalog.operations).toContain("render");
  expect(
    (
      await fetch(`${local}/health`, {
        headers: { Authorization: `Bearer ${base.token}`, Host: "evil.example.com" },
      })
    ).status,
  ).toBe(403);
  const job = runner.jobs.start({
    id: "test",
    revision: runner.projects.read("test").revision,
    target: "page",
    kind: "preview",
    requestId: "proxy-preview",
  });
  const deadline = Date.now() + 30000;
  while (["queued", "running"].includes(job.status) && Date.now() < deadline) await Bun.sleep(100);
  expect(job.status).toBe("succeeded");
  const preview = await (
    await fetch(`${local}/rpc`, {
      method: "POST",
      headers: { Authorization: `Bearer ${base.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ op: "preview", input: { id: job.id } }),
    })
  ).json();
  expect(new URL(preview.url).origin).toBe("https://preview.example.com");
}, 35000);
