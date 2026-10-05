import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decode, definition, RenderSchema, renderSettings } from "@bcr/work-core";
import { diagnose } from "../src/diagnostics";
import { Projects } from "../src/projects";
import { Jobs } from "../src/jobs";
import { operationCatalog } from "../src/operations";

const cleanup: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const dispose of cleanup.splice(0).reverse()) await dispose();
});
function fixture() {
  const temp = mkdtempSync(join(tmpdir(), "bcr-render-options-"));
  cleanup.push(() => rmSync(temp, { recursive: true, force: true }));
  const root = join(temp, "work");
  mkdirSync(root);
  writeFileSync(
    join(root, "work.json"),
    JSON.stringify({
      format: "bcr-project-1",
      id: "test",
      title: "Render options",
      targets: [
        { id: "page", runtime: "html", entry: "index.html" },
        {
          id: "video",
          runtime: "remotion",
          entry: "Scene.tsx",
          width: 1080,
          height: 1920,
          fps: 30,
          durationInFrames: 1800,
          assets: ["public/font.woff2", "public/audio.wav"],
        },
      ],
    }),
  );
  writeFileSync(join(root, "index.html"), "<h1>Test</h1>");
  writeFileSync(join(root, "Scene.tsx"), "export default () => null;");
  const projects = new Projects(root, join(temp, "state"));
  const jobs = new Jobs(projects, "test-engine");
  cleanup.push(() => jobs.close());
  const project = projects.read("test");
  const request = decode(RenderSchema, {
    id: "test",
    target: "video",
    revision: project.revision,
    requestId: "test-render",
    kind: "video",
  });
  return { project, request, jobs };
}

test("one contract supplies CLI/HTTP/MCP render defaults and rejects unsupported values", () => {
  const { request } = fixture();
  expect(renderSettings(request)).toEqual({
    profile: "final",
    scale: 1,
    crf: 18,
    gl: null,
    hardwareAcceleration: "disable",
  });
  expect(renderSettings({ ...request, profile: "draft" })).toEqual({
    profile: "draft",
    scale: 0.5,
    crf: 26,
    gl: null,
    hardwareAcceleration: "disable",
  });
  expect(
    renderSettings({ ...request, profile: "draft", scale: 0.25, crf: 0, gl: "swangle" }),
  ).toEqual({
    profile: "draft",
    scale: 0.25,
    crf: 0,
    gl: "swangle",
    hardwareAcceleration: "disable",
  });
  expect(renderSettings({ ...request, hardwareAcceleration: "required" })).toEqual({
    profile: "final",
    scale: 1,
    crf: 18,
    gl: null,
    hardwareAcceleration: "required",
  });
  for (const invalid of [
    { profile: "ultra" },
    { crf: 52 },
    { crf: -1 },
    { crf: 18.5 },
    { gl: "shell-command" },
    { hardwareAcceleration: "cuda" },
    { scale: 0 },
  ])
    expect(() => decode(RenderSchema, { ...request, ...invalid })).toThrow();
  const schema = JSON.stringify(operationCatalog.find((op) => op.name === "render")!.schema);
  for (const key of ["profile", "crf", "gl", "hardwareAcceleration"]) expect(schema).toContain(key);
});

test("render identity includes quality and backend; invalid options fail before entering the queue", () => {
  const { request, jobs } = fixture();
  const keys = [
    {},
    { profile: "draft" },
    { crf: 21 },
    { gl: "swangle" },
    { hardwareAcceleration: "required" },
    { scale: 0.25 },
  ].map(
    (options, i) => {
      const job = jobs.start({ ...request, ...options, requestId: `job-${i}` });
      jobs.cancel(job.id);
      return job.renderKey;
    },
  );
  expect(new Set(keys).size).toBe(keys.length);
  const original = jobs.start({ ...request, profile: "draft" });
  expect(jobs.start({ ...request, profile: "draft" }).id).toBe(original.id);
  expect(() => jobs.start({ ...request, profile: "final" })).toThrow("requestId");
  jobs.cancel(original.id);
  expect(() => jobs.start({ ...request, requestId: "odd", scale: 0.101 })).toThrow("偶数");
  expect(() =>
    jobs.start({ ...request, requestId: "preview", kind: "preview", profile: "draft" }),
  ).toThrow("质量选项");
  expect(() => jobs.start({ ...request, requestId: "image", kind: "capture", crf: 20 })).toThrow(
    "视频编码",
  );
  expect(() =>
    jobs.start({ ...request, requestId: "html", kind: "validate", target: "page", gl: "angle" }),
  ).toThrow("质量选项");
  expect(() =>
    jobs.start({ ...request, requestId: "gpu-crf", hardwareAcceleration: "required", crf: 18 }),
  ).toThrow("硬件编码");
});

test("asset diagnostics use snapshot hashes and report missing/empty files without assuming font readiness", () => {
  const { project, request } = fixture();
  const target = project.targets[1]!;
  expect(diagnose(project, target, request).errors).toEqual([
    "缺少声明的素材：public/font.woff2",
    "缺少声明的素材：public/audio.wav",
  ]);
  const files = [
    { path: "public/font.woff2", hash: "a".repeat(64), size: 512 },
    { path: "public/audio.wav", hash: "b".repeat(64), size: 0 },
  ];
  const result = diagnose({ ...project, files }, target, request);
  expect(result.errors).toEqual(["素材为空：public/audio.wav"]);
  expect(result.fonts).toEqual(["public/font.woff2"]);
  expect(result.assets).toEqual(files);
  expect(result.sourceRevision).toBe(project.revision);
  expect(() =>
    definition({ ...project.definition, targets: [{ ...target, assets: ["../outside"] }] }),
  ).toThrow();
});
