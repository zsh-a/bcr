import { describe, expect, it, vi } from "vitest";
import { MemoryStore } from "@bcr/storage-opfs";
import { requiresApproval } from "@bcr/agent";
import { decodeCatalog } from "@bcr/agent/bridge";
import { WorkspaceFiles } from "../src/workspace/files";
import { WorkStore } from "../src/works/store";
import { WorkPreview } from "../src/works/preview";
import { workCapability } from "../src/works/agent";
import { exportWork, readWorkArchive } from "../src/works/archive";
import type { WorkCommit } from "../src/works/model";
import { workDocument } from "../src/works/document";

function setup(records = new Map<string, string>(), binary = new MemoryStore()) {
  const metadata = {
    get: async (key: string) => records.get(key),
    set: async (key: string, value: string) => {
      records.set(key, value);
    },
    batch: vi.fn(async (entries: ReadonlyArray<readonly [string, string | undefined]>) => {
      for (const [key, value] of entries) {
        if (value === undefined) records.delete(key);
        else records.set(key, value);
      }
    }),
  };
  const files = new WorkspaceFiles(binary),
    store = new WorkStore(metadata, files);
  const capability = workCapability(store, new WorkPreview());
  const tool = (name: string) => capability.tools.find((t) => t.spec.name === `work_${name}`)!;
  const call = async (name: string, args: unknown) =>
    JSON.parse(await tool(name).call(JSON.stringify(args)));
  return { store, files, records, binary, metadata, tool, call };
}
const initial: WorkCommit = {
  requestId: "create",
  revision: null,
  title: "An arbitrary work",
  entry: "index.html",
  put: [
    { path: "index.html", text: "<h1>Hello</h1>" },
    { path: "data.json", text: "[1,2,3]" },
  ],
};

describe("generic versioned works", () => {
  it("compiles inert HTML without a DOM, preserves document attributes and rejects missing/external imports", async () => {
    const s = setup();
    const work = await s.store.commit({
      ...initial,
      put: [
        {
          path: "index.html",
          text: '<html lang="en" class="dark"><head><title>old</title></head><body class="reader"><script type="module" src="./app.js"></script></body></html>',
        },
        { path: "app.js", text: 'import { value } from "./value.js"; console.log(value)' },
        { path: "value.js", text: 'export const value = "</script>";' },
        {
          path: "build.js",
          text: 'import fs from "node:fs"; // retained source, not a browser dependency',
        },
      ],
    });
    const html = await workDocument(work, s.files);
    expect(html).toContain('<html lang="en" class="dark">');
    expect(html).toContain('<body class="reader">');
    expect(html).toContain("bcr-file:/value.js");
    expect(html.indexOf("Content-Security-Policy")).toBeLessThan(html.indexOf("<script"));
    const invalid = await s.store.commit({
      requestId: "external",
      id: work.id,
      revision: work.revision,
      put: [{ path: "app.js", text: 'import "https://example.com/app.js";' }],
    });
    await expect(workDocument(invalid, s.files)).rejects.toThrow("相对文件");
  });
  it("patches only targeted files, keeps pinned versions and replays across sessions", async () => {
    const a = setup(),
      first = await a.store.commit(initial);
    const next = await a.store.commit({
      requestId: "patch",
      id: first.id,
      revision: first.revision,
      put: [{ path: "index.html", text: "<h1>Updated</h1>" }],
    });
    expect(next.files.find((f) => f.path === "data.json")).toEqual(
      first.files.find((f) => f.path === "data.json"),
    );
    expect(await a.store.read(first.id, first.revision)).toEqual(first);
    const b = setup(a.records, a.binary);
    expect(await b.store.commit(initial)).toEqual(first);
    expect((await b.store.read(first.id)).revision).toBe(next.revision);
    await expect(b.store.commit({ ...initial, title: "Another payload" })).rejects.toThrow(
      "requestId",
    );
    expect((await b.store.history(first.id)).items.map((w) => w.revision)).toEqual([
      next.revision,
      first.revision,
    ]);
    const restored = await b.store.commit({
      requestId: "restore",
      id: first.id,
      revision: next.revision,
      restoreRevision: first.revision,
    });
    expect(restored.files).toEqual(first.files);
    expect(restored.parent).toBe(next.revision);
    expect(restored.revision).not.toBe(first.revision);
  });
  it("rejects stale parallel writers, protects drafts and permits only the owning editor", async () => {
    const s = setup(),
      first = await s.store.commit(initial);
    const draft = s.store.registerDraft(first.id, () => true);
    const update = { requestId: "edit", id: first.id, revision: first.revision, title: "Edited" };
    await expect(s.store.commit(update)).rejects.toThrow("未保存");
    const saved = await s.store.commit(update, undefined, draft.token);
    draft.dispose();
    const results = await Promise.allSettled(
      ["a", "b"].map((requestId) =>
        s.store.commit({ ...update, revision: saved.revision, requestId }),
      ),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
  });
  it("validates paths, references, missing blobs and aborts without publishing a partial head", async () => {
    const s = setup(),
      first = await s.store.commit(initial);
    for (const path of ["../private", "/absolute", "a//b", "a/../b", "a\\b", "a\u0000b", "a/ b"]) {
      expect(() => s.store.commit({ ...initial, put: [{ path, text: "bad" }] })).toThrow();
    }
    const edit = { requestId: "edit", id: first.id, revision: first.revision };
    await expect(s.store.commit({ ...edit, remove: ["index.html"] })).rejects.toThrow("入口");
    await expect(
      s.store.commit({
        ...edit,
        put: [
          {
            path: "bad.png",
            artifact: { hash: "0".repeat(64), name: "bad", size: 1, mime: "image/png" },
          },
        ],
      }),
    ).rejects.toThrow("校验");
    s.metadata.batch.mockRejectedValueOnce(new Error("disk full"));
    await expect(s.store.commit({ ...edit, title: "Cannot save" })).rejects.toThrow("disk full");
    await expect(
      s.store.commit({ ...edit, title: "Aborted" }, AbortSignal.abort()),
    ).rejects.toThrow();
    expect(await s.store.read(first.id)).toEqual(first);
    expect((await s.store.history(first.id)).items).toHaveLength(1);
  });
  it("archives and restores arbitrary binary/text files into an empty workspace without executing code", async () => {
    const s = setup(),
      first = await s.store.commit(initial);
    const image = await s.files.import(
      new Blob([new Uint8Array([0, 1, 255])], { type: "image/png" }),
      "image.png",
    );
    const work = await s.store.commit({
      requestId: "image",
      id: first.id,
      revision: first.revision,
      put: [{ path: "image.png", artifact: image }],
    });
    const zip = await exportWork(work, s.files),
      archive = await readWorkArchive(zip);
    expect(archive.work).toEqual(work);
    const target = setup(),
      artifact = await target.files.import(zip, "work.zip");
    const restored = await target.call("import", { requestId: "import", artifact });
    expect(restored.id).not.toBe(work.id);
    expect(restored.files).toEqual(work.files);
    for (const f of restored.files)
      expect((await target.files.read(f.artifact)).size).toBe(f.artifact.size);
    expect((await target.call("import", { requestId: "import", artifact })).revision).toBe(
      restored.revision,
    );
    expect((await target.call("read", { id: restored.id })).preview.status).toBe("idle");
  });
  it("reads workspace files and rejects incorrect size or modified bytes", async () => {
    const s = setup(),
      blob = new Blob(["valid"], { type: "text/plain" }),
      file = await s.files.import(blob, "source.txt");
    expect(await (await s.files.read(file)).text()).toBe("valid");
    await expect(s.files.read({ ...file, size: blob.size + 1 })).rejects.toThrow("校验");
    await s.binary.putStream(`workspace/files/${file.hash}`, new Blob(["other"]).stream());
    await expect(s.files.read(file)).rejects.toThrow("校验");
  });
  it("exposes generic schemas, gates execution/writes and makes paged file reads explicit", async () => {
    const s = setup();
    expect(() =>
      decodeCatalog({
        workspace: "test",
        label: "test",
        files: true,
        write: true,
        tools: workCapability(s.store, new WorkPreview()).tools.map((t) => ({
          ...t.spec,
          capability: "workspace.works",
        })),
      }),
    ).not.toThrow();
    for (const name of ["commit", "preview", "export", "import"]) {
      expect(requiresApproval(s.tool(name).spec)).toBe(true);
      expect(s.tool(name).preview).toBeTypeOf("function");
    }
    expect(requiresApproval(s.tool("read").spec)).toBe(false);
    expect((await s.call("catalog", {})).commit.properties).toHaveProperty("put");
    const work = await s.call("commit", {
      ...initial,
      put: [{ path: "index.html", text: "x".repeat(64001) }],
    });
    const part = await s.call("read", { id: work.id, path: "index.html" });
    expect(part.text).toHaveLength(32000);
    expect(part.nextOffset).toBe(32000);
    await expect(
      s.call("read", { id: work.id, path: "index.html", offset: 32000 }),
    ).rejects.toThrow("revision");
    expect(
      (
        await s.call("read", {
          id: work.id,
          revision: work.revision,
          path: "index.html",
          offset: 64000,
        })
      ).text,
    ).toBe("x");
  });
});
