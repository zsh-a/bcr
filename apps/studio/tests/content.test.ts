import { describe, expect, it, vi } from "vitest";
import { createTextCitation, textVersion } from "@bcr/core";
import type { FixedUseModel } from "@bcr/economics-core";
import { MemoryStore } from "@bcr/storage-opfs";
import { ContentStore } from "../src/content/store";
import { claimStatus, decodeProject, newProject, runModel } from "../src/content/model";
import { createRelease, decodeRelease } from "../src/content/release";
import { exportArchive, prepareArchive, restoreArchive } from "../src/content/archive";
import { KnowledgeStore } from "../src/knowledge/session/store";
import { newNote } from "../src/knowledge/session/model";
import { importPrices } from "../src/content/importPrices";
import { assertSavedNote } from "../src/content/service";
import { assertArticleAssets } from "../src/content/articleAssets";
import { rewriteMarkdownUrls } from "../src/knowledge/attachments/attachmentModel";
import { visualUrl } from "../src/content/links";
import { BlobReader, BlobWriter, TextReader, ZipReader, ZipWriter } from "@zip.js/zip.js";

function setup() {
  const records = new Map<string, string>(),
    binary = new MemoryStore();
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
  return {
    records,
    metadata,
    binary,
    store: new ContentStore(metadata, binary),
    knowledge: new KnowledgeStore(metadata, binary),
  };
}
async function fixture() {
  const s = setup();
  await Promise.all([s.store.ready, s.knowledge.ready]);
  const note = { ...newNote("健身卡"), body: "使用 40 次持平，从第 41 次起更便宜。" };
  await s.knowledge.saveNote(note, null);
  let project = decodeProject({ ...newProject(), noteId: note.id });
  const run = runModel(project);
  const anchor = createTextCitation(
    note.body,
    { scope: note.id, unit: note.id, offset: 0, version: textVersion(note.body) },
    { start: 0, end: 12 },
  );
  project = await s.store.save(
    {
      ...project,
      claims: [
        {
          id: "claim-1",
          anchor,
          output: "firstCheaper",
          reviewedRun: run.id,
          reviewedValue: "41",
          reviewedAt: Date.now(),
        },
      ],
    },
    null,
  );
  const font = await s.store.assets.import(new Blob(["font fixture"]), "font.woff");
  return { ...s, project, note, font };
}

describe("content project integrity", () => {
  it("rejects stale revisions and does not publish failed writes", async () => {
    const s = setup(),
      p = await s.store.save(newProject(), null);
    s.metadata.batch.mockRejectedValueOnce(new Error("disk full"));
    await expect(s.store.save({ ...p, title: "failed" }, p.revision)).rejects.toThrow("disk full");
    expect(s.store.getSnapshot()[0]!.title).toBe(p.title);
    await s.store.save({ ...p, title: "saved" }, p.revision);
    await expect(s.store.save(p, p.revision)).rejects.toThrow("其他窗口");
  });
  it("marks price and evidence changes for review while preserving the old text", async () => {
    const { project, note } = await fixture();
    expect(claimStatus(project.claims[0]!, note.body, runModel(project))).toBe("current");
    const next: FixedUseModel = structuredClone(project.model!);
    next.parameters.fixed = { ...next.parameters.fixed, value: "3000" };
    expect(claimStatus(project.claims[0]!, note.body, runModel({ ...project, model: next }))).toBe(
      "review",
    );
    expect(claimStatus(project.claims[0]!, "完全不同的论述", runModel(project))).toBe("relink");
    expect(note.body).toContain("41");
  });
  it("keeps release input immutable and rejects altered output", async () => {
    const s = await fixture(),
      release = createRelease(s.project, s.note, s.font, []);
    const changed: FixedUseModel = structuredClone(s.project.model!);
    changed.parameters.fixed = { ...changed.parameters.fixed, value: "3000" };
    await s.store.save(
      { ...s.project, model: changed, releases: [release.id] },
      s.project.revision,
      [release],
    );
    expect((await s.store.release(release.id)).run!.result.breakEven.firstCheaper).toBe("41");
    const corrupt = structuredClone(release);
    corrupt.run!.result.breakEven.firstCheaper = "999";
    expect(() => decodeRelease(corrupt)).toThrow();
    expect(() => createRelease({ ...s.project, model: changed }, s.note, s.font, [])).toThrow(
      "复核",
    );
  });
  it("restores the full dependency closure into fresh storage and reuses repeated imports", async () => {
    const s = await fixture(),
      release = createRelease(s.project, s.note, s.font, []);
    const project = await s.store.save(
      { ...s.project, releases: [release.id] },
      s.project.revision,
      [release],
    );
    const prepared = await prepareArchive(await exportArchive(s.store, s.knowledge, project));
    const target = setup();
    const restored = await restoreArchive(prepared, target.store, target.knowledge);
    expect(restored.id).not.toBe(project.id);
    expect(runModel(restored).result).toEqual(runModel(project).result);
    expect((await target.store.assets.read(release.font)).size).toBe(release.font.size);
    expect((await target.store.release(release.id)).article!.body).toBe(s.note.body);
    expect((await restoreArchive(prepared, target.store, target.knowledge)).id).toBe(restored.id);
    expect(target.store.getSnapshot()).toHaveLength(1);
    expect(Object.keys(target.knowledge.getSnapshot().notes)).toHaveLength(1);
  });
  it("preserves changed restored notes and recovers an interrupted project commit", async () => {
    const s = await fixture(),
      prepared = await prepareArchive(await exportArchive(s.store, s.knowledge, s.project));
    const target = setup();
    await Promise.all([target.store.ready, target.knowledge.ready]);
    const original = target.metadata.batch.getMockImplementation()!;
    target.metadata.batch.mockImplementation(async (entries) => {
      if (entries.some(([key]) => key.startsWith("content/project/")))
        throw new Error("interrupted");
      await original(entries);
    });
    await expect(restoreArchive(prepared, target.store, target.knowledge)).rejects.toThrow(
      "interrupted",
    );
    target.metadata.batch.mockImplementation(original);
    const p = await restoreArchive(prepared, target.store, target.knowledge);
    const note = target.knowledge.getSnapshot().notes[p.noteId!]!;
    await target.knowledge.saveNote({ ...note, body: "已手工修改" }, note);
    await expect(restoreArchive(prepared, target.store, target.knowledge)).rejects.toThrow(
      "已被修改",
    );
  });
  it("imports raw decimal prices with source files and rejects broken CSV", async () => {
    const s = setup();
    await s.store.ready;
    const p = await importPrices(
      new File(["parameter,value\nfixed,0.3\nalternative,0.1"], "prices.csv", { type: "text/csv" }),
      newProject(),
      s.store,
    );
    expect(p.model!.parameters.fixed.value).toBe("0.3");
    expect(p.evidence[0]!.asset).not.toBeNull();
    expect(runModel(p).result.breakEven.firstCheaper).toBe("4");
    await expect(
      importPrices(new File(["parameter,value\nfixed,1\nfixed,2"], "bad.csv"), p, s.store),
    ).rejects.toThrow("重复");
    await expect(importPrices(new File(["price\n2"], "bad.csv"), p, s.store)).rejects.toThrow(
      "两列",
    );
  });
  it("rejects missing source bindings and unsafe source URLs", () => {
    const p = newProject();
    expect(() =>
      decodeProject({
        ...p,
        model: {
          ...p.model,
          parameters: {
            ...p.model.parameters,
            fixed: { ...p.model.parameters.fixed, evidenceId: "missing" },
          },
        },
      }),
    ).toThrow("证据缺失");
    expect(() =>
      decodeProject({
        ...p,
        evidence: [
          {
            id: "unsafe",
            title: "Bad URL",
            url: "javascript:alert(1)",
            capturedAt: 0,
            applicableDate: "",
            region: "",
            store: "",
            specification: "",
            author: "",
            license: "",
            text: "",
            asset: null,
          },
        ],
      }),
    ).toThrow("HTTP(S)");
  });
  it("blocks release reads when another editor has an unsaved draft", async () => {
    const s = await fixture(),
      unregister = s.knowledge.registerDraft(s.note.id, () => true);
    expect(() => assertSavedNote(s.knowledge, s.note.id)).toThrow("草稿");
    unregister();
    expect(assertSavedNote(s.knowledge, s.note.id).id).toBe(s.note.id);
  });
  it("rewrites only used Markdown destinations and checks portable image dependencies", () => {
    const project = newProject(),
      url = visualUrl(project.id, 0);
    const raw = `\`${url}\`\n\n![图](${url})\n\n![引用][image]\n\n[image]: <${url}>\n\n[unused]: ${url}`;
    const rewritten = rewriteMarkdownUrls(raw, (value) =>
      value === url ? "charts/chart-1.png" : null,
    );
    expect(rewritten).toContain(`\`${url}\``);
    expect(rewritten).toContain("![图](charts/chart-1.png)");
    expect(rewritten).toContain("[image]: <charts/chart-1.png>");
    expect(rewritten).toContain(`[unused]: ${url}`);
    expect(() => assertArticleAssets(raw, project, [])).not.toThrow();
    expect(() =>
      assertArticleAssets("![外链](https://example.com/image.png)", project, []),
    ).toThrow("外部图片");
    expect(() => assertArticleAssets("![图](content-visual:other:0)", project, [])).toThrow(
      "当前项目",
    );
    expect(() => assertArticleAssets("![附件](attachment:missing)", project, [])).toThrow(
      "附件不完整",
    );
  });
  it("rejects missing archive dependencies and unsafe paths before restoration", async () => {
    const s = await fixture(),
      release = createRelease(s.project, s.note, s.font, []);
    const project = await s.store.save(
      { ...s.project, releases: [release.id] },
      s.project.revision,
      [release],
    );
    const archive = await exportArchive(s.store, s.knowledge, project),
      zip = new ZipReader(new BlobReader(archive));
    const entries = await zip.getEntries(),
      manifestEntry = entries.find((e) => e.filename === "manifest.json")!;
    if (manifestEntry.directory) throw new Error("Expected manifest file");
    const manifest = await manifestEntry.getData(new BlobWriter());
    await zip.close();
    const missing = new ZipWriter(new BlobWriter());
    await missing.add("manifest.json", new BlobReader(manifest), { useWebWorkers: false });
    await expect(prepareArchive(await missing.close())).rejects.toThrow("素材");
    const unsafe = new ZipWriter(new BlobWriter());
    await unsafe.add("../escape", new TextReader("bad"), { useWebWorkers: false });
    await expect(prepareArchive(await unsafe.close())).rejects.toThrow(/路径|Unsafe filename/u);
  });
});
