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
import { WorkService, workRoute } from "../src/works/service";
import { WorkSession } from "../src/works/session";
import type { Project } from "@bcr/work-core";

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
  const service = new WorkService(store);
  const capability = workCapability(store, new WorkPreview(), service);
  const tool = (name: string) => capability.tools.find((t) => t.spec.name === `work_${name}`)!;
  const call = async (name: string, args: unknown) =>
    JSON.parse(await tool(name).call(JSON.stringify(args)));
  return { store, files, records, binary, metadata, tool, call, service };
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
  it("checks Runner SHA-256 bytes independently of browser BLAKE3 storage", async () => {
    const s = setup();
    const ref = { provider: "local" as const, sourceId: "runner-a", id: "work" };
    const output = {
      key: "job/video.mp4",
      name: "video.mp4",
      mime: "video/mp4",
      size: 3,
      jobId: "job",
      hashAlgorithm: "sha256" as const,
      hash: "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    };
    const read = vi.spyOn(s.service, "output").mockResolvedValue(new Blob(["abc"]));
    expect(await (await s.service.reviewOutput(ref, output)).text()).toBe("abc");
    await expect(
      s.service.reviewOutput(ref, { ...output, hashAlgorithm: "blake3" }),
    ).rejects.toThrow("完整性");
    read.mockResolvedValue(new Blob(["abd"]));
    await expect(s.service.reviewOutput(ref, output)).rejects.toThrow("完整性");
    s.service.close();
  });

  it("browser review snapshots compile offline output, keep acceptance explicit and export a pinned delivery", async () => {
    const s = setup();
    const work = await s.store.commit(initial);
    const ref = { sourceId: "browser", provider: "browser" as const, id: work.id };
    const edit = async (action: unknown) =>
      s.call("review_edit", {
        id: work.id,
        sourceId: "browser",
        revision: (await s.call("review_read", { id: work.id, sourceId: "browser" })).revision,
        requestId: crypto.randomUUID(),
        action,
      });
    const first = await edit({
      kind: "submit",
      submissionId: "v1",
      sourceRevision: work.revision,
      target: "page",
      title: "First",
      summary: "Initial",
      addresses: [],
    });
    expect(
      await (await s.service.reviewOutput(ref, first.submissions[0].outputs[0])).text(),
    ).toContain("<h1>Hello</h1>");
    await edit({
      kind: "comment",
      feedbackId: "f1",
      submissionId: "v1",
      comment: "Make the heading clearer",
      anchor: { point: { x: 0.2, y: 0.3 } },
    });
    const updated = await s.store.commit({
      id: work.id,
      revision: work.revision,
      requestId: "new-source",
      put: [{ path: "index.html", text: "<h1>Clear heading</h1>" }],
    });
    const second = await edit({
      kind: "submit",
      submissionId: "v2",
      sourceRevision: updated.revision,
      target: "page",
      title: "Second",
      summary: "Clearer heading",
      addresses: ["f1"],
    });
    expect(second.feedback[0].status).toBe("addressed");
    const delivery = {
      kind: "deliver",
      deliveryId: "d1",
      title: "Release",
      selections: [{ submissionId: "v2", outputs: ["page"] }],
    };
    await expect(edit(delivery)).rejects.toThrow("未确认");
    await edit({ kind: "decide", feedbackId: "f1", submissionId: "v2", decision: "accept" });
    const delivered = await edit(delivery);
    const { ZipReader, BlobReader, TextWriter } = await import("@zip.js/zip.js");
    const zip = new ZipReader(
      new BlobReader(await s.service.deliveryBundle(ref, delivered.deliveries[0])),
    );
    try {
      const entries = await zip.getEntries();
      const html = entries.find((e) => e.filename.endsWith("index.html"));
      expect(
        html &&
          !html.directory &&
          (await html.getData?.(new TextWriter(), { useWebWorkers: false })),
      ).toContain("<h1>Clear heading</h1>");
      expect(entries.some((e) => e.filename === "delivery.json")).toBe(true);
    } finally {
      await zip.close();
    }
    expect(
      (await s.call("delivery_export", { id: work.id, sourceId: "browser", deliveryId: "d1" }))
        .artifact.mime,
    ).toBe("application/zip");
    expect(
      await (await s.service.reviewOutput(ref, first.submissions[0].outputs[0])).text(),
    ).toContain("<h1>Hello</h1>");
  });

  it("pins multiple compiled pages and validates screenshot bytes and dimensions", async () => {
    const s = setup();
    const work = await s.store.commit({
      ...initial,
      put: [...initial.put!, { path: "pages/sources.html", text: "<h1>Sources</h1>" }],
    });
    const ref = { id: work.id, sourceId: "browser", provider: "browser" as const };
    const book = await s.store.reviewEdit({
      id: work.id,
      revision: "initial",
      requestId: "pages",
      action: {
        kind: "submit",
        submissionId: "pages",
        sourceRevision: work.revision,
        target: "page",
        title: "Pages",
        summary: "Both pages",
        addresses: [],
        pages: [
          { path: "index.html", title: "Home" },
          { path: "pages/sources.html", title: "Sources" },
        ],
      },
    });
    const submission = book.submissions[0]!;
    expect(submission.build).toBe("bcr-page-2");
    expect(submission.pages).toHaveLength(2);
    expect((await s.service.reviewDocument(ref, submission, "pages/sources.html")).html).toContain(
      "<h1>Sources</h1>",
    );
    await s.store.commit({
      id: work.id,
      revision: work.revision,
      requestId: "later",
      put: [{ path: "pages/sources.html", text: "<h1>Changed</h1>" }],
    });
    const readingSource = vi
      .spyOn(s.store, "read")
      .mockRejectedValue(new Error("Review must not recompile source"));
    expect((await s.service.reviewDocument(ref, submission, "pages/sources.html")).html).toContain(
      "<h1>Sources</h1>",
    );
    readingSource.mockRestore();
    await expect(s.service.reviewDocument(ref, submission, "absent.html")).rejects.toThrow(
      "固定的页面",
    );
    const image = await s.files.import(new Blob(["not PNG"], { type: "image/png" }), "page.png");
    await expect(
      s.store.reviewEdit({
        id: work.id,
        revision: book.revision,
        requestId: "bad-view",
        action: {
          kind: "view",
          view: {
            id: "bad",
            submissionId: submission.id,
            title: "Invalid",
            page: { path: "index.html", viewport: { width: 1280, height: 800 } },
            image: { ...image, hashAlgorithm: "blake3", mime: "image/png" },
            elements: [],
            warnings: [],
            engine: "test",
            createdAt: 0,
          },
        },
      }),
    ).rejects.toThrow("PNG");
    expect((await s.store.reviewRead(work.id)).views ?? []).toHaveLength(0);
    s.service.close();
  });

  it("a late response from an abandoned pairing cannot replace or disconnect the new source", async () => {
    const s = setup();
    let finishOld!: (response: Response) => void;
    const oldResponse = new Promise<Response>((resolve) => {
      finishOld = resolve;
    });
    const catalog = (sourceId: string) =>
      Response.json({ format: "bcr-runner-1", sourceId, root: "/projects", version: "test" });
    vi.stubGlobal("location", { origin: "http://bcr.test" });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        if (typeof init.body !== "string") throw new Error("Expected JSON request body");
        const request = JSON.parse(init.body);
        if (request.op === "catalog")
          return url.includes("runner-a") ? oldResponse : catalog("runner-b");
        return Response.json({ items: [], errors: [] });
      }),
    );
    try {
      const old = s.service.local.connect("http://runner-a.test", "token-a");
      const rejected = expect(old).rejects.toThrow();
      await s.service.local.connect("http://runner-b.test", "token-b");
      finishOld(catalog("runner-a"));
      await rejected;
      expect(s.service.local.getSnapshot().sourceId).toBe("runner-b");
      expect(s.service.local.getSnapshot().status).toBe("connected");
    } finally {
      s.service.close();
      vi.unstubAllGlobals();
    }
  });

  it("pins reads and mutations to a source and rejects ambiguous legacy IDs", async () => {
    const s = setup();
    const browser = await s.store.commit(initial);
    const local: Project = {
      ref: { provider: "local", sourceId: "runner-a", id: browser.id },
      title: "Same ID",
      revision: "a".repeat(64),
      directory: "/project",
      definition: {
        format: "bcr-project-1",
        id: browser.id,
        title: "Same ID",
        targets: [{ id: "page", runtime: "html", entry: "index.html" }],
      },
      targets: [{ id: "page", runtime: "html", entry: "index.html" }],
      files: [],
      capabilities: ["read", "preview"],
    };
    const connection = vi
      .spyOn(s.service.local, "getSnapshot")
      .mockReturnValue({ status: "connected", sourceId: "runner-a", items: [local], errors: [] });
    vi.spyOn(s.service.local, "refresh").mockResolvedValue();
    const rpc = vi.spyOn(s.service.local, "call").mockResolvedValue(local);
    await s.service.list();
    await expect(s.call("read", { id: browser.id })).rejects.toThrow("不明确");
    expect((await s.call("read", { id: browser.id, sourceId: "browser" })).work.format).toBe(
      "bcr-work-1",
    );
    expect((await s.call("read", { id: browser.id, sourceId: "runner-a" })).work.directory).toBe(
      "/project",
    );
    expect(workRoute(local.ref)).toContain("source=runner-a");
    connection.mockReturnValue({
      status: "connected",
      sourceId: "runner-b",
      items: [{ ...local, ref: { ...local.ref, sourceId: "runner-b" } }],
      errors: [],
    });
    rpc.mockClear();
    await expect(s.call("read", { id: browser.id, sourceId: "runner-a" })).rejects.toThrow(
      "另一个 Runner",
    );
    await expect(s.call("cancel", { jobId: "job", sourceId: "runner-a" })).rejects.toThrow(
      "另一个 Runner",
    );
    await expect(
      s.call("output", { jobId: "job", name: "video.mp4", sourceId: "runner-a" }),
    ).rejects.toThrow("另一个 Runner");
    await expect(s.call("commit", { ...initial, sourceId: "runner-b" })).rejects.toThrow(
      "浏览器文件",
    );
    expect(rpc).not.toHaveBeenCalled();
  });
  it("keeps stale parameter drafts and CAS revisions in the session, while protecting them from Agent writes", async () => {
    const s = setup();
    const target = {
      id: "video",
      runtime: "remotion" as const,
      entry: "Scene.tsx",
      width: 100,
      height: 100,
      fps: 30,
      durationInFrames: 60,
      propsFile: "data.json",
      parameters: [{ key: "price", label: "Price", type: "number" as const }],
    };
    const work: Project = {
      ref: { sourceId: "runner-a", provider: "local", id: "project" },
      title: "Project",
      revision: "a".repeat(64),
      directory: "/project",
      targets: [target],
      definition: { format: "bcr-project-1", id: "project", title: "Project", targets: [target] },
      files: [],
      capabilities: [],
    };
    vi.spyOn(s.service.local, "getSnapshot").mockReturnValue({
      status: "connected",
      sourceId: "runner-a",
      items: [work],
      errors: [],
    });
    const rpc = vi.spyOn(s.service.local, "call").mockImplementation(async (op) => {
      if (op === "file") return { text: '{"price":10}', nextOffset: null };
      if (op === "jobs") return [];
      if (op === "reviews") return { revision: "b".repeat(64), items: [] };
      if (op === "parameters") throw new Error("作品版本冲突，请重新读取");
      throw new Error(`Unexpected ${op}`);
    });
    const session = new WorkSession(s.service, work);
    const dispose = session.start();
    try {
      await vi.waitFor(() => expect(session.getSnapshot().loadingParams).toBe(false));
      session.setParameter("price", 20);
      session.update({ ...work, revision: "c".repeat(64) });
      expect(session.getSnapshot().params.price).toBe(20);
      expect(session.getSnapshot().base).toBe(work.revision);
      await expect(
        s.call("parameters", {
          id: "project",
          revision: work.revision,
          target: "video",
          requestId: "agent",
          values: { price: 30 },
          sourceId: "runner-a",
        }),
      ).rejects.toThrow("未保存");
      await session.run(() => session.saveParameters());
      expect(session.getSnapshot().error).toContain("冲突");
      expect(session.getSnapshot().dirty).toBe(true);
      expect(rpc.mock.calls.find(([op]) => op === "parameters")?.[1]).toMatchObject({
        revision: work.revision,
        values: { price: 20 },
      });
      session.discard();
      await vi.waitFor(() => expect(session.getSnapshot().loadingParams).toBe(false));
      expect(session.getSnapshot().base).toBe("c".repeat(64));
    } finally {
      dispose();
    }
    expect(rpc.mock.calls.some(([op]) => op === "cancel")).toBe(false);
  });

  it("reads bounded Runner diagnostics directly without importing files, and rejects binary text feedback", async () => {
    const s = setup();
    const text = JSON.stringify({ errors: [], fonts: ["public/font.woff2"] });
    const imported = vi.spyOn(s.files, "import");
    const job = {
      status: "succeeded",
      request: { revision: "a".repeat(64) },
      outputs: [
        { name: "diagnostics.json", size: text.length },
        { name: "frame-0.png", size: 100 },
        { name: "oversized.json", size: 65537 },
      ],
    };
    vi.spyOn(s.service.local, "getSnapshot").mockReturnValue({
      status: "connected",
      sourceId: "runner-a",
      items: [],
      errors: [],
    });
    vi.spyOn(s.service.local, "call").mockResolvedValue(job);
    const output = vi.spyOn(s.service.local, "output").mockResolvedValue(new Blob([text]));
    expect(await s.call("output", { jobId: "job", name: "diagnostics.json", text: true })).toEqual({
      jobId: "job",
      sourceRevision: "a".repeat(64),
      text,
    });
    expect(imported).not.toHaveBeenCalled();
    await expect(
      s.call("output", { jobId: "job", name: "frame-0.png", text: true }),
    ).rejects.toThrow("文本反馈");
    await expect(
      s.call("output", { jobId: "job", name: "oversized.json", text: true }),
    ).rejects.toThrow("64 KiB");
    expect(output).toHaveBeenCalledTimes(1);
  });
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
  it("shares named source history and recoverable restore with Agent tools while protecting drafts", async () => {
    const s = setup();
    const first = await s.store.commit(initial);
    const checkpoint = await s.call("checkpoint", {
      id: first.id,
      revision: first.revision,
      requestId: "named",
      message: "Starting point",
    });
    expect(checkpoint.message).toBe("Starting point");
    const second = await s.store.commit({
      id: first.id,
      revision: checkpoint.revision,
      requestId: "edit",
      put: [{ path: "index.html", text: "<h1>Changed</h1>" }],
    });
    const diff = await s.call("diff", {
      id: first.id,
      from: checkpoint.revision,
      to: second.revision,
      path: "index.html",
    });
    expect(diff.changes).toHaveLength(1);
    expect(diff.detail.before).toBe("<h1>Hello</h1>");
    expect(diff.detail.after).toBe("<h1>Changed</h1>");
    const history = await s.call("versions", { id: first.id });
    expect(history.head).toBe(second.revision);
    expect(history.items[1].message).toBe("Starting point");
    const input = {
      id: first.id,
      revision: second.revision,
      restoreRevision: checkpoint.revision,
      requestId: "restore-version",
    };
    const draft = s.store.registerDraft(first.id, () => true);
    await expect(s.call("restore", input)).rejects.toThrow("未保存");
    draft.dispose();
    const restored = await s.call("restore", input);
    expect(restored.revision).not.toBe(checkpoint.revision);
    expect(restored.restoredFrom).toBe(checkpoint.revision);
    expect(restored.files).toEqual(first.files);
    expect((await s.call("restore", input)).revision).toBe(restored.revision);
    expect((await s.call("versions", { id: first.id })).items[0].kind).toBe("restore");
    expect((await s.store.read(first.id, second.revision)).files).toEqual(second.files);
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
