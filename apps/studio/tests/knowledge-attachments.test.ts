import { describe, expect, it } from "vitest";
import { MemoryStore } from "@bcr/storage-opfs";
import { contentHash, artifactStore, ArtifactStoreTag, type RuntimeServices } from "@bcr/core";
import { Context, Effect, Layer } from "effect";
import { createDocumentContentPackage } from "@bcr/document-core";
import {
  BlobReader,
  BlobWriter,
  TextReader,
  TextWriter,
  ZipReader,
  ZipWriter,
} from "@zip.js/zip.js";
import { KnowledgeStore } from "../src/knowledge/store";
import { contentOf, decodeState, newNote } from "../src/knowledge/model";
import {
  attachmentArchivePath,
  attachmentPath,
  attachmentMarkdown,
  attachmentReferences,
  decodeAttachments,
  mergeAttachments,
  rewriteAttachmentUrls,
} from "../src/knowledge/attachmentModel";
import {
  planKnowledgeRestore,
  readKnowledgeBackup,
  writeKnowledgeBackup,
  writeMarkdownArchive,
} from "../src/knowledge/backup";
import { contentFiles } from "../src/knowledge/files";
import { GitHubKnowledge } from "../src/knowledge/github";
import { syncKnowledge } from "../src/knowledge/sync";
import { createKnowledgeGitHub } from "../../../scripts/fixtures/knowledge-github.mjs";
import { knowledgeCapability } from "../src/knowledge/agent";
import { readAttachmentText } from "../src/knowledge/attachmentText";

function device() {
  const records = new Map<string, string>(),
    binary = new MemoryStore();
  let fail = false;
  const metadata = {
    get: async (key: string) => records.get(key),
    set: async (key: string, value: string) => {
      if (fail) throw new Error("disk full");
      records.set(key, value);
    },
    batch: async (entries: ReadonlyArray<readonly [string, string | undefined]>) => {
      if (fail) throw new Error("disk full");
      for (const [key, value] of entries)
        if (value === undefined) records.delete(key);
        else records.set(key, value);
    },
  };
  return {
    store: new KnowledgeStore(metadata, binary),
    metadata,
    binary,
    records,
    fail: (value: boolean) => {
      fail = value;
    },
  };
}
const png = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3XcAAAAASUVORK5CYII=",
  ),
  (c) => c.charCodeAt(0),
);
const picture = () => new File([png], "截图.png", { type: "image/png" });
async function attached(d = device()) {
  const asset = await d.store.importAttachment(picture());
  const note = {
    ...newNote("带附件的笔记"),
    path: "研究/笔记.md",
    body: `${attachmentMarkdown(asset)}\n\n引用 ${attachmentMarkdown({ ...asset, mime: "application/octet-stream" })}`,
  };
  await d.store.saveNote(note, null);
  return { ...d, asset, note };
}

describe("knowledge attachments", () => {
  it("indexes Markdown images and file references, excluding code and unused definitions", () => {
    const body =
      "![图](attachment:one)\n[文档][file]\n\n[file]: attachment:two\n[unused]: attachment:three\n\n`[代码](attachment:four)`\n```md\n![例子](attachment:five)\n```\n";
    expect(attachmentReferences(body).map((ref) => [ref.id, ref.image])).toEqual([
      ["one", true],
      ["two", false],
    ]);
    const exported = rewriteAttachmentUrls(body, (id) => `assets/${id}.bin`);
    expect(exported).toContain("![图](assets/one.bin)");
    expect(exported).toContain("[file]: assets/two.bin");
    expect(exported).toContain("`[代码](attachment:four)`");
  });
  it("validates immutable identities and rejects corrupt manifest records", async () => {
    const { asset } = await attached();
    expect(() => decodeAttachments({ [asset.id]: { ...asset, size: -1 } })).toThrow();
    expect(() =>
      mergeAttachments({ [asset.id]: asset }, { [asset.id]: { ...asset, hash: "0".repeat(64) } }),
    ).toThrow("身份冲突");
  });
  it("rewrites destinations without touching titles, code, or unused and shadowed definitions", () => {
    const body =
      '[attachment:one](attachment:one "](")\n\n[file]: attachment:two\n[file]: attachment:shadow\n[unused]: attachment:missing\n\n[file]';
    const output = rewriteAttachmentUrls(body, (id) => `assets/${id}`);
    expect(output).toContain('[attachment:one](assets/one "](")');
    expect(output).toContain("[file]: assets/two");
    expect(output).toContain("[file]: attachment:shadow");
    expect(output).toContain("[unused]: attachment:missing");
    expect(rewriteAttachmentUrls("<attachment:one>", (id) => `assets/${id}`)).toBe(
      "[attachment:one](assets/one)",
    );
  });
  it("repairs incomplete local files using only verified matching originals", async () => {
    const d = await attached(),
      path = `artifacts/${attachmentPath(d.asset.hash)}`;
    await d.binary.put(path, new Uint8Array());
    await d.store.importAttachment(picture());
    expect(new Uint8Array(await (await d.store.attachments.verify(d.asset)).arrayBuffer())).toEqual(
      png,
    );
    await d.binary.put(path, new Uint8Array(png.length));
    await d.store.attachments.extract(d.asset, (sink) => picture().stream().pipeTo(sink));
    expect(await d.store.attachments.verify(d.asset)).toBeDefined();
  });
  it("aborts a failed producer without committing a partial file", async () => {
    const a = await attached(),
      b = device();
    await expect(
      b.store.attachments.extract(a.asset, async (sink) => {
        const writer = sink.getWriter();
        await writer.write(png.slice(0, 8));
        writer.releaseLock();
        throw new Error("download interrupted");
      }),
    ).rejects.toThrow("download interrupted");
    expect(await b.store.attachments.get(a.asset)).toBeUndefined();
    await b.store.attachments.extract(a.asset, (sink) => picture().stream().pipeTo(sink));
    expect(await b.store.attachments.verify(a.asset)).toBeDefined();
  });
  it("deduplicates file bytes and identities and survives record-based reload", async () => {
    const d = await attached();
    const again = await d.store.importAttachment(
      new File([png], "另一个名字.png", { type: "image/png" }),
    );
    expect(again.id).toBe(d.asset.id);
    expect(await d.binary.list("artifacts/knowledge/attachments/")).toHaveLength(1);
    const reopened = new KnowledgeStore(d.metadata, d.binary);
    await reopened.ready;
    expect(reopened.getSnapshot()).toEqual(d.store.getSnapshot());
    expect(new Uint8Array(await (await reopened.attachments.require(again)).arrayBuffer())).toEqual(
      png,
    );
    expect(decodeState(JSON.stringify(reopened.getSnapshot()))).toEqual(reopened.getSnapshot());
  });
  it("does not publish attachment metadata when its persistence receipt fails", async () => {
    const d = device();
    await d.store.ready;
    d.fail(true);
    await expect(d.store.importAttachment(picture())).rejects.toThrow("disk full");
    expect(d.store.getSnapshot().attachments).toBeUndefined();
  });
  it("retains originals when an image reference is removed and the note is restored", async () => {
    const d = await attached();
    await d.store.saveNote({ ...d.note, body: "无图" }, d.note);
    await d.store.restore(d.note);
    expect(await d.store.attachments.require(d.asset)).toBeDefined();
    expect(d.store.getSnapshot().notes[d.note.id]?.body).toContain(`attachment:${d.asset.id}`);
  });
  it("protects originals, thumbnails and text from general artifact cleanup", async () => {
    const d = await attached();
    await d.binary.put(
      `artifacts/knowledge/attachments/previews/${d.asset.hash}.webp`,
      new Uint8Array([1]),
    );
    await d.binary.put(
      `artifacts/knowledge/attachments/text/${d.asset.hash}/page.json`,
      new Uint8Array([2]),
    );
    await d.binary.put("artifacts/tmp/orphan", new Uint8Array([3]));
    const context = await Effect.runPromise(
      Effect.scoped(Layer.build(artifactStore({ opfs: d.binary }))),
    );
    const artifacts = Context.get(context, ArtifactStoreTag);
    const plan = await Effect.runPromise(
      artifacts.planCleanup({ protectedPrefixes: ["knowledge/attachments"] }),
    );
    expect(plan.candidates.map((item) => item.id)).toEqual(["tmp/orphan"]);
    await Effect.runPromise(artifacts.reclaim(plan));
    expect(await d.store.attachments.require(d.asset)).toBeDefined();
    expect(await d.binary.list("artifacts/knowledge/attachments/")).toHaveLength(3);
  });
  it("roundtrips binary files in a complete ZIP and restores to another device", async () => {
    const a = await attached(),
      b = device();
    const zip = await writeKnowledgeBackup(contentOf(a.store.getSnapshot()), a.store.attachments);
    const incoming = await readKnowledgeBackup(zip, b.store.attachments);
    const base = contentOf(await b.store.ready.then(() => b.store.getSnapshot()));
    await b.store.restoreBackup(planKnowledgeRestore(base, incoming, "skip").content, base);
    expect(b.store.getSnapshot().notes[a.note.id]?.path).toBe("研究/笔记.md");
    expect(
      new Uint8Array(await (await b.store.attachments.require(a.asset)).arrayBuffer()),
    ).toEqual(png);
  });
  it("rejects missing originals and checksum failures without modifying notes", async () => {
    const a = await attached(),
      b = device(),
      content = contentOf(a.store.getSnapshot());
    await expect(writeKnowledgeBackup(content, b.store.attachments)).rejects.toThrow("缺少附件");
    const zip = new ZipWriter(new BlobWriter(), { useWebWorkers: false });
    for (const [path, text] of Object.entries(contentFiles(content)))
      await zip.add(path, new TextReader(text));
    await zip.add(
      attachmentArchivePath(a.asset.hash),
      new BlobReader(new Blob([new Uint8Array(png.length)])),
    );
    await expect(readKnowledgeBackup(await zip.close(), b.store.attachments)).rejects.toThrow(
      "校验失败",
    );
    await b.store.ready;
    expect(Object.keys(b.store.getSnapshot().notes)).toHaveLength(0);
  });
  it("fails export for a dangling attachment reference", async () => {
    const note = { ...newNote("缺失"), body: "![图](attachment:missing)" };
    await expect(
      writeKnowledgeBackup({ notes: { [note.id]: note }, collections: {}, folders: [] }),
    ).rejects.toThrow("缺少附件记录");
  });
  it("exports portable relative links with one copy of each original", async () => {
    const d = await attached(),
      reader = new ZipReader(
        new BlobReader(
          await writeMarkdownArchive(contentOf(d.store.getSnapshot()), d.store.attachments),
        ),
      );
    try {
      const entries = await reader.getEntries();
      expect(entries.filter((entry) => entry.filename.startsWith("_attachments/"))).toHaveLength(1);
      const md = entries.find((entry) => entry.filename === "研究/笔记.md");
      if (!md || md.directory) throw new Error("missing note");
      const text = await md.getData(new TextWriter());
      expect(text).toContain(`../_attachments/${d.asset.hash}.png`);
      expect(text).not.toContain("attachment:");
    } finally {
      await reader.close();
    }
  });
  it("syncs complete binary attachments between two private-repository devices", async () => {
    const a = await attached(),
      b = device(),
      fixture = createKnowledgeGitHub();
    const target = { owner: "alice", repo: "notes", branch: "main" };
    const remote = new GitHubKnowledge(target, "test-token", fixture.fetch as typeof fetch);
    await a.store.configure(target);
    await b.store.configure(target);
    await syncKnowledge(a.store, remote);
    await syncKnowledge(b.store, remote);
    expect(
      new Uint8Array(await (await b.store.attachments.require(a.asset)).arrayBuffer()),
    ).toEqual(png);
    expect(fixture.files()["other/keep.txt"]).toBe("untouched");
    const uploads = fixture.state.requests.filter(
      (request) => request.method === "POST" && request.path === "/git/blobs",
    ).length;
    await syncKnowledge(a.store, remote);
    expect(
      fixture.state.requests.filter(
        (request) => request.method === "POST" && request.path === "/git/blobs",
      ),
    ).toHaveLength(uploads);
    fixture.advance({ [attachmentArchivePath(a.asset.hash)]: null });
    await expect(syncKnowledge(b.store, remote)).rejects.toThrow("远端缺少附件");
    expect(b.store.getSnapshot().notes[a.note.id]?.body).toBe(a.note.body);
  });
  it("avoids portable asset directory collisions and preserves note metadata", async () => {
    const d = await attached();
    const note = { ...d.note, path: `_attachments/${d.asset.hash}.md`, tags: ["研究"] };
    const content = { ...contentOf(d.store.getSnapshot()), notes: { [note.id]: note } };
    const reader = new ZipReader(
      new BlobReader(await writeMarkdownArchive(content, d.store.attachments)),
    );
    try {
      const entries = await reader.getEntries(),
        entry = entries.find((item) => item.filename === note.path);
      if (!entry || entry.directory) throw new Error("missing Markdown");
      const md = await entry.getData(new TextWriter());
      expect(md).toContain(`../_attachments-2/${d.asset.hash}.png`);
      expect(md).toContain("tags:");
      expect(md).toContain("研究");
    } finally {
      await reader.close();
    }
  });
  it("reuses local OCR tasks, selects the requested language, and caches derived text", async () => {
    const d = device();
    const asset = await d.store.importAttachment(
      new File([png], "看起来像文本.txt", { type: "text/plain" }),
    );
    const content = createDocumentContentPackage({
      id: "ocr",
      format: "image",
      sourceName: asset.name,
      sourceHash: asset.hash,
      adapter: "manga.onnx",
      blocks: [{ text: "画像の文字" }],
    });
    let calls = 0;
    const compute = {
      scheduler: {
        submit: (task: { config?: unknown }) => {
          calls++;
          expect(task.config).toMatchObject({ sourceLanguage: "ja", adapter: "manga.onnx" });
          return Effect.succeed({
            await: Effect.succeed([{ id: "ocr-output" }]),
            cancel: Effect.void,
          });
        },
      },
      artifacts: { get: () => Effect.succeed(new TextEncoder().encode(JSON.stringify(content))) },
    } as unknown as Pick<RuntimeServices, "scheduler" | "artifacts">;
    const store = new KnowledgeStore(d.metadata, d.binary, compute);
    await expect(readAttachmentText(store, asset)).rejects.toThrow("尚未识别");
    expect((await readAttachmentText(store, asset, { ocr: true, language: "ja" })).text).toBe(
      "画像の文字",
    );
    expect((await readAttachmentText(store, asset, { language: "ja" })).text).toBe("画像の文字");
    expect(calls).toBe(1);
    await expect(
      readAttachmentText(store, asset, { signal: AbortSignal.abort() }),
    ).rejects.toThrow();
  });
  it("reads Unicode text in bounded pages without splitting multibyte characters", async () => {
    const d = device(),
      text = "知识库附件📚\n".repeat(9000);
    const asset = await d.store.importAttachment(
      new File([text], "资料.txt", { type: "text/plain" }),
    );
    let output = "",
      page = 1,
      offset = 0;
    for (;;) {
      const result = await readAttachmentText(d.store, asset, { page, offset });
      expect(result.text.length).toBeLessThanOrEqual(12000);
      expect(/[\ud800-\udbff]$/u.test(result.text)).toBe(false);
      output += result.text;
      if (result.nextOffset !== null) offset = result.nextOffset;
      else if (result.nextPage !== null) {
        page = result.nextPage;
        offset = 0;
      } else break;
    }
    expect(output).toBe(text);
    expect(output).not.toContain("�");
  });
  it("offers paginated attachment tools with note provenance and immutable version guards", async () => {
    const d = device(),
      asset = await d.store.importAttachment(
        new File(["引用原文"], "资料.txt", { type: "text/plain" }),
      );
    const note = { ...newNote("引用"), body: attachmentMarkdown(asset) };
    await d.store.saveNote(note, null);
    const tools = knowledgeCapability(d.store).tools;
    const list = tools.find((tool) => tool.spec.name === "knowledge_list_attachments")!;
    const read = tools.find((tool) => tool.spec.name === "knowledge_read_attachment")!;
    const result = JSON.parse(await list.call(JSON.stringify({ noteId: note.id })));
    expect(result.attachments[0].noteIds).toEqual([note.id]);
    expect(
      JSON.parse(await read.call(JSON.stringify({ id: asset.id, version: asset.hash }))).text,
    ).toBe("引用原文");
    await expect(
      read.call(JSON.stringify({ id: asset.id, version: contentHash(new Uint8Array()) })),
    ).rejects.toThrow("版本已变化");
  });
});
