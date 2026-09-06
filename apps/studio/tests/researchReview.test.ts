import { describe, expect, it } from "vitest";
import { createSearchIndex, createTextCitation, textVersion, type SearchDocument } from "@bcr/core";
import {
  assessExcerpt,
  decodeResearch,
  exportResearch,
  ResearchStore,
  type ResearchLibrary,
} from "../src/research";
import { createResearchBackup, decodeResearchBackup } from "../src/researchBackup";
import { linkPreview, relinkExcerpt } from "../src/researchReview";
const originalText = "最初的证据。",
  updatedText = "修订后的证据。";
const source = {
  scope: "reader:book:section",
  unit: "section",
  offset: 0,
  version: textVersion(originalText),
};
const library: ResearchLibrary = {
  version: 1,
  collections: [
    {
      id: "collection",
      name: "研究",
      excerpts: [
        {
          id: "excerpt",
          documentId: "doc",
          title: "Title",
          source: "Reader",
          owner: "reader",
          route: "/reader?book=book&section=section",
          text: originalText,
          note: "个人理解",
          draft: "未保存草稿",
          savedAt: 1,
          citation: createTextCitation(originalText, source, { start: 0, end: 6 }),
        },
      ],
    },
  ],
};
function setup() {
  const search = createSearchIndex();
  const document: SearchDocument = {
    id: "doc",
    source: "reader",
    kind: "reader-section",
    title: "Current",
    body: updatedText,
    route: "/reader?book=book&section=section",
    updatedAt: 2,
    citation: { ...source, version: textVersion(updatedText) },
  };
  search.replaceSource("reader", [document]);
  return { search, document: search.documents()[0]! };
}
const range = { start: 0, end: 6 };
describe("research citation maintenance", () => {
  it("appends a link while retaining original snapshot, notes, draft and identity", () => {
    const { search, document } = setup();
    const original = library.collections[0]!.excerpts[0]!;
    expect(assessExcerpt(original, search).state).toBe("changed");
    const next = relinkExcerpt(library, "collection", "excerpt", document, range, 0, search, 100);
    const linked = next.collections[0]!.excerpts[0]!;
    expect(linked).toMatchObject(original);
    expect(linked.links).toHaveLength(1);
    expect(linked.links![0]!.text).toBe(updatedText);
    expect(assessExcerpt(linked, search).state).toBe("exact");
    expect(assessExcerpt(linked, search).route).toContain("cite=");
    expect(original.links).toBeUndefined();
    const second = relinkExcerpt(
      next,
      "collection",
      "excerpt",
      document,
      { start: 2, end: 5 },
      1,
      search,
      200,
    );
    expect(second.collections[0]!.excerpts[0]!.links).toHaveLength(2);
  });
  it("rejects stale previews, unloaded sources, invalid ranges and concurrent revisions", () => {
    const { search, document } = setup();
    for (const invalid of [
      { start: NaN, end: 1 },
      { start: 1.5, end: 3 },
      { start: 1, end: 1 },
      { start: 0, end: 999 },
    ])
      expect(() => linkPreview(document, invalid)).toThrow();
    expect(() =>
      relinkExcerpt(library, "collection", "excerpt", document, range, 1, search),
    ).toThrow("已变化");
    search.replaceSource("reader", [{ ...document, body: "后来再次修改" }]);
    expect(() =>
      relinkExcerpt(library, "collection", "excerpt", document, range, 0, search),
    ).toThrow("来源已变化");
    const cold = createSearchIndex();
    cold.upsert(document);
    expect(() =>
      relinkExcerpt(library, "collection", "excerpt", document, range, 0, cold),
    ).toThrow();
  });
  it("roundtrips history through backup and Markdown without changing the initial evidence", () => {
    const { search, document } = setup();
    const next = relinkExcerpt(library, "collection", "excerpt", document, range, 0, search, 100);
    const backup = createResearchBackup(next, true, { getItem: () => null });
    expect(decodeResearchBackup(JSON.stringify(backup)).library).toEqual(next);
    const md = exportResearch(next.collections[0]!, "https://example.test");
    expect(md).toContain(originalText);
    expect(md).toContain(updatedText);
    expect(md).toContain("重新关联记录");
    const bad = structuredClone(next);
    Object.assign(bad.collections[0]!.excerpts[0]!.links![0]!, { route: "javascript:alert(1)" });
    expect(() => decodeResearch(JSON.stringify(bad))).toThrow();
    expect(decodeResearch(JSON.stringify(library))).toEqual(library);
  });
  it("does not publish revisions on failed persistence and permits retry", async () => {
    const { search, document } = setup();
    let fail = true,
      raw = JSON.stringify(library);
    const store = new ResearchStore({
      get: async () => raw,
      set: async (_: string, value: string) => {
        if (fail) throw new Error("full");
        raw = value;
      },
    });
    await store.ready;
    const apply = (current: ResearchLibrary) =>
      relinkExcerpt(current, "collection", "excerpt", document, range, 0, search, 100);
    await expect(store.update(apply)).rejects.toThrow();
    expect(store.getSnapshot()).toEqual(library);
    fail = false;
    await store.update(apply);
    expect(decodeResearch(raw).collections[0]!.excerpts[0]!.links).toHaveLength(1);
  });
});
