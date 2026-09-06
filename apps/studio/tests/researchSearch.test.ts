import { describe, expect, it } from "vitest";
import { createSearchIndex } from "@bcr/core";
import { ResearchStore, type ResearchLibrary } from "../src/research";
import {
  publishResearch,
  researchDocuments,
  researchSource,
  researchTarget,
} from "../src/researchSearch";
import { moveExcerpt, renameCollection, deleteCollection } from "../src/researchManagement";
const library: ResearchLibrary = {
  version: 1,
  collections: [
    {
      id: "one",
      name: "研究甲",
      excerpts: [
        {
          id: "excerpt",
          documentId: "original",
          title: "来源标题",
          source: "Reader",
          route: "/reader?book=source",
          text: "保存正文证据",
          note: "个人理解标记",
          draft: "秘密草稿",
          savedAt: 1,
        },
      ],
    },
    { id: "two", name: "研究乙", excerpts: [] },
  ],
};
describe("research search projections", () => {
  it("indexes committed notes and snapshots separately, with internal targets rather than source citations", () => {
    const index = createSearchIndex();
    publishResearch(index, library);
    const note = index.search("个人理解")[0]!;
    expect(note.document.kind).toBe("research-note");
    expect(note.document.citation).toBeUndefined();
    expect(researchTarget(note.document)).toEqual({
      collection: "one",
      excerpt: "excerpt",
      field: "note",
      offset: 0,
    });
    expect(index.search("正文证据")[0]?.document.kind).toBe("research-excerpt");
    expect(index.search("秘密草稿")).toEqual([]);
    expect(index.search("个人理解", { sources: [researchSource("two")] })).toEqual([]);
  });
  it("updates renamed, moved and deleted entries without leaving old source projections", () => {
    const index = createSearchIndex();
    publishResearch(index, library);
    const renamed = renameCollection(library, "one", "新集合名称");
    publishResearch(index, renamed);
    expect(index.search("研究甲")).toEqual([]);
    expect(index.search("新集合名称")).toHaveLength(2);
    const moved = moveExcerpt(renamed, "one", "two", "excerpt");
    publishResearch(index, moved);
    expect(index.search("个人理解", { sources: [researchSource("one")] })).toEqual([]);
    expect(researchTarget(index.search("个人理解")[0]!.document)?.collection).toBe("two");
    publishResearch(index, deleteCollection(moved, "two"));
    expect(index.search("个人理解")).toEqual([]);
  });
  it("does not publish failed saves and removes saved-note entries after clearing a note", async () => {
    let raw = JSON.stringify(library),
      fail = true;
    const metadata = {
      get: async () => raw,
      set: async (_: string, value: string) => {
        if (fail) throw new Error("full");
        raw = value;
      },
    };
    const store = new ResearchStore(metadata),
      index = createSearchIndex();
    await store.ready;
    publishResearch(index, store.getSnapshot());
    store.subscribe(() => publishResearch(index, store.getSnapshot()));
    const edit = (current: ResearchLibrary): ResearchLibrary => ({
      ...current,
      collections: current.collections.map((collection) => ({
        ...collection,
        excerpts: collection.excerpts.map((item) => ({ ...item, note: "" })),
      })),
    });
    await expect(store.update(edit)).rejects.toThrow();
    expect(index.search("个人理解")).toHaveLength(1);
    fail = false;
    await store.update(edit);
    expect(index.search("个人理解")).toEqual([]);
    expect(index.search("正文证据")).toHaveLength(1);
  });
  it("restores new kinds and preserves absolute UTF-16 positions beyond the first chunk", async () => {
    const text = "背景".repeat(15000) + "ＡＬＰＨＡ e\u0301";
    const expanded = {
      ...library,
      collections: [
        {
          ...library.collections[0]!,
          excerpts: [{ ...library.collections[0]!.excerpts[0]!, text }],
        },
      ],
    };
    const documents = researchDocuments(expanded);
    const index = createSearchIndex({
      load: async () => JSON.stringify({ version: 1, documents }),
      save: async () => {},
    });
    await index.ready;
    const result = index.search("alpha")[0]!;
    const target = researchTarget(result.document)!;
    expect(text.slice(target.offset + result.match!.start, target.offset + result.match!.end)).toBe(
      "ＡＬＰＨＡ",
    );
    publishResearch(index, { version: 1, collections: [] });
    expect(index.search("alpha")).toEqual([]);
  });
});
