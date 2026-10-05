import { afterEach, expect, test } from "bun:test";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
  existsSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Projects } from "../src/projects";
import { VersionRepository } from "../src/versions";

const directories: string[] = [];
afterEach(() => {
  for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true });
});
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "bcr-versions-"));
  directories.push(dir);
  const root = join(dir, "project");
  mkdirSync(root);
  writeFileSync(
    join(root, "work.json"),
    JSON.stringify({
      format: "bcr-project-1",
      id: "work",
      title: "Work",
      targets: [{ id: "page", runtime: "html", entry: "index.html" }],
    }),
  );
  writeFileSync(join(root, "index.html"), "<h1>Original</h1>");
  writeFileSync(join(root, "data.json"), '{"price":100}');
  const projects = new Projects(root, join(dir, "state")),
    versions = new VersionRepository(projects);
  const first = projects.read("work");
  return { dir, root, projects, versions, first };
}
test("named checkpoints, diffs and restore keep source identities and preserve unrelated private files", () => {
  const { root, projects, versions, first } = fixture();
  const checkpoint = {
    id: "work",
    revision: first.revision,
    requestId: "checkpoint",
    message: "原始方案",
  };
  versions.checkpoint(checkpoint);
  versions.checkpoint(checkpoint);
  expect(versions.list({ id: "work" }).items).toHaveLength(1);
  expect(() => versions.checkpoint({ ...checkpoint, message: "changed" })).toThrow("requestId");
  writeFileSync(join(root, "index.html"), "<h1>Updated</h1>");
  writeFileSync(join(root, "added.txt"), "new");
  writeFileSync(join(root, ".env"), "private");
  mkdirSync(join(root, ".git"));
  writeFileSync(join(root, ".git", "HEAD"), "keep");
  const second = projects.read("work");
  const diff = versions.diff({
    id: "work",
    from: first.revision,
    to: second.revision,
    path: "index.html",
  });
  expect(diff.changes.map((f) => [f.path, f.status])).toEqual([
    ["added.txt", "added"],
    ["index.html", "modified"],
  ]);
  expect(diff.detail?.before).toBe("<h1>Original</h1>");
  expect(diff.detail?.after).toBe("<h1>Updated</h1>");
  expect(() =>
    versions.restore({
      id: "work",
      revision: first.revision,
      restoreRevision: first.revision,
      requestId: "stale",
    }),
  ).toThrow("冲突");
  const input = {
    id: "work",
    revision: second.revision,
    restoreRevision: first.revision,
    requestId: "restore",
  };
  expect(versions.restore(input).revision).toBe(first.revision);
  expect(versions.restore(input).revision).toBe(first.revision);
  expect(versions.list({ id: "work" }).items.filter((v) => v.kind === "restore")).toHaveLength(1);
  expect(readFileSync(join(root, ".env"), "utf8")).toBe("private");
  expect(readFileSync(join(root, ".git", "HEAD"), "utf8")).toBe("keep");
  expect(existsSync(join(root, "added.txt"))).toBe(false);
  expect(projects.file("work", second.revision, "index.html").toString()).toContain("Updated");
  writeFileSync(join(root, "index.html"), "<h1>Agent edit after restore</h1>");
  versions.restore(input); // Replay must not overwrite a later edit.
  expect(readFileSync(join(root, "index.html"), "utf8")).toContain("Agent edit");
});
test("interrupted restore resumes only its own known writes and never overwrites an external edit", () => {
  const { root, projects, versions, first } = fixture();
  versions.checkpoint({
    id: "work",
    revision: first.revision,
    requestId: "checkpoint",
    message: "Start",
  });
  writeFileSync(join(root, "index.html"), "<h1>Second</h1>");
  writeFileSync(join(root, "data.json"), '{"price":200}');
  const second = projects.read("work");
  const input = {
    id: "work",
    revision: second.revision,
    restoreRevision: first.revision,
    requestId: "restore",
  };
  const apply = projects.applySnapshot.bind(projects);
  projects.applySnapshot = (before, after, checkOnly) => {
    if (checkOnly) return apply(before, after, true);
    writeFileSync(join(root, "data.json"), '{"price":100}');
    throw new Error("simulated restart");
  };
  expect(() => versions.restore(input)).toThrow("simulated restart");
  projects.applySnapshot = apply;
  const resumed = new VersionRepository(projects);
  expect(resumed.list({ id: "work" }).pending).toEqual(input);
  const manifest = readFileSync(join(root, "work.json"), "utf8");
  writeFileSync(join(root, "work.json"), "{broken");
  expect(resumed.discovery().items[0]?.ref.id).toBe("work");
  writeFileSync(join(root, "work.json"), manifest);
  expect(resumed.discovery().items[0]?.revision).toBe(second.revision);
  expect(resumed.discovery().errors.some((e) => e.message.includes("恢复尚未完成"))).toBe(true);
  expect(() => resumed.restore({ ...input, requestId: "different" })).toThrow("尚未完成");
  writeFileSync(join(root, "index.html"), "<h1>Concurrent edit</h1>");
  expect(() => resumed.restore(input)).toThrow("外部修改");
  expect(readFileSync(join(root, "index.html"), "utf8")).toContain("Concurrent");
  writeFileSync(join(root, "index.html"), "<h1>Second</h1>");
  expect(resumed.restore(input).revision).toBe(first.revision);
  expect(resumed.list({ id: "work" }).pending).toBeUndefined();
});
test("restore rejects symlinks before writing source", () => {
  const { root, dir, projects, versions, first } = fixture();
  versions.checkpoint({
    id: "work",
    revision: first.revision,
    requestId: "checkpoint",
    message: "Start",
  });
  writeFileSync(join(root, "data.json"), '{"price":300}');
  const second = projects.read("work");
  symlinkSync(join(dir, "outside"), join(root, "new-link"));
  expect(() =>
    versions.restore({
      id: "work",
      revision: second.revision,
      restoreRevision: first.revision,
      requestId: "restore",
    }),
  ).toThrow("符号链接");
  expect(readFileSync(join(root, "data.json"), "utf8")).toContain("300");
});
test("file/directory replacement fails preflight without leaving a pending restore", () => {
  const { root, projects, versions } = fixture();
  writeFileSync(join(root, "caption"), "original file");
  const first = projects.read("work");
  versions.checkpoint({
    id: "work",
    revision: first.revision,
    requestId: "base",
    message: "Start",
  });
  rmSync(join(root, "caption"));
  mkdirSync(join(root, "caption"));
  writeFileSync(join(root, "caption", "text.txt"), "nested content");
  writeFileSync(join(root, "data.json"), '{"price":300}');
  const second = projects.read("work");
  expect(() =>
    versions.restore({
      id: "work",
      revision: second.revision,
      restoreRevision: first.revision,
      requestId: "restore",
    }),
  ).toThrow();
  expect(versions.list({ id: "work" }).pending).toBeUndefined();
  expect(readFileSync(join(root, "data.json"), "utf8")).toContain("300");
  expect(readFileSync(join(root, "caption", "text.txt"), "utf8")).toBe("nested content");
});
