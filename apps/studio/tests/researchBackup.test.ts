import { describe, expect, it } from "vitest";
import { createSearchIndex } from "@bcr/core";
import { assessExcerpt, ResearchStore, type ResearchLibrary } from "../src/research";
import {
  createResearchBackup,
  decodeResearchBackup,
  planResearchImport,
} from "../src/researchBackup";
import { readDraft } from "../src/researchManagement";
const empty: ResearchLibrary = { version: 1, collections: [] };
const library: ResearchLibrary = {
  version: 1,
  collections: [
    {
      id: "collection",
      name: "研究",
      excerpts: [
        {
          id: "backup-item",
          documentId: "doc",
          title: "Title",
          source: "Reader",
          route: "/reader?book=original",
          text: "正文快照",
          note: "已保存笔记",
          savedAt: 10,
          owner: "reader",
        },
      ],
    },
  ],
};
const storage = { getItem: () => "未保存草稿" };
describe("research backup", () => {
  it("roundtrips saved notes and restores optional drafts durably without source claims", () => {
    const backup = createResearchBackup(library, true, storage, 100);
    const decoded = decodeResearchBackup(JSON.stringify(backup));
    const restored = planResearchImport(empty, decoded).library;
    const item = restored.collections[0]!.excerpts[0]!;
    expect(item.note).toBe("已保存笔记");
    expect(readDraft(item, { getItem: () => null })).toBe("未保存草稿");
    expect(item.route).toBe("/reader?book=original");
    expect(assessExcerpt(item, createSearchIndex()).state).toBe("unverified");
    const without = createResearchBackup(restored, false, storage);
    expect(without.library.collections[0]!.excerpts[0]!.draft).toBeUndefined();
  });
  it("does not read browser storage when drafts are excluded; reports unreadable drafts", () => {
    const blocked = {
      getItem: () => {
        throw new Error("storage blocked");
      },
    };
    expect(() => createResearchBackup(library, false, blocked)).not.toThrow();
    expect(() => createResearchBackup(library, true, blocked)).toThrow("storage blocked");
  });
  it("skips repeated imports and preserves both sides of a conflict", () => {
    const backup = createResearchBackup(library, false, storage);
    expect(planResearchImport(library, backup).skipped).toBe(1);
    const modified = {
      ...library,
      collections: [{ ...library.collections[0]!, name: "local changes" }],
    };
    const plan = planResearchImport(modified, backup);
    expect(plan.copies).toBe(1);
    expect(plan.library.collections[0]).toBe(modified.collections[0]);
    expect(plan.library.collections[1]!.excerpts[0]!.id).not.toBe(
      library.collections[0]!.excerpts[0]!.id,
    );
    expect(planResearchImport(plan.library, backup).skipped).toBe(1);
    expect(planResearchImport(plan.library, backup).added).toBe(0);
  });
  it("isolates draft identities when different collections contain the same excerpt ID", () => {
    const current = { ...library, collections: [{ ...library.collections[0]!, id: "other" }] };
    const plan = planResearchImport(current, createResearchBackup(library, true, storage));
    expect(plan.copies).toBe(1);
    expect(plan.library.collections[1]!.excerpts[0]!.id).not.toBe(
      library.collections[0]!.excerpts[0]!.id,
    );
  });
  it("rejects corrupt versions, dates, links and contradictory drafts before writing", () => {
    const backup = createResearchBackup(library, true, storage);
    for (const patch of [
      { version: 2 },
      { createdAt: null },
      { includesDrafts: false },
      { library: null },
    ]) {
      expect(() => decodeResearchBackup(JSON.stringify({ ...backup, ...patch }))).toThrow();
    }
    const bad = structuredClone(backup);
    Object.assign(bad.library.collections[0]!.excerpts[0]!, { route: "javascript:alert(1)" });
    expect(() => decodeResearchBackup(JSON.stringify(bad))).toThrow();
    expect(() => decodeResearchBackup(" ".repeat(16 * 1024 * 1024 + 1))).toThrow("16 MiB");
  });
  it("keeps the library intact on persistence failure, then restores notes and drafts together", async () => {
    let raw = JSON.stringify(empty),
      fail = true;
    const metadata = {
      get: async () => raw,
      set: async (_: string, value: string) => {
        if (fail) throw new Error("full");
        raw = value;
      },
    };
    const store = new ResearchStore(metadata);
    await store.ready;
    const backup = createResearchBackup(library, true, storage);
    await expect(
      store.update((current) => planResearchImport(current, backup).library),
    ).rejects.toThrow();
    expect(store.getSnapshot()).toEqual(empty);
    fail = false;
    await store.update((current) => planResearchImport(current, backup).library);
    const restored = new ResearchStore(metadata);
    await restored.ready;
    expect(restored.getSnapshot()).toEqual(backup.library);
  });
});
