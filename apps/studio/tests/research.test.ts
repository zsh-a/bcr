import { describe, expect, it } from "vitest";
import {
  citationRoute,
  decodeResearch,
  exportResearch,
  excerptFromDocument,
  ResearchStore,
  type ResearchLibrary,
} from "../src/research";

const document = {
  id: "reader:s:1",
  source: "reader",
  kind: "reader-section" as const,
  title: "章节 [一]",
  subtitle: "一本书",
  body: "真实原文\n<script>unsafe</script>",
  route: "/reader?book=b&section=s&start=0",
  updatedAt: 1,
};
const excerpt = excerptFromDocument(document, 1000);
const collection = { id: "one", name: "研究", excerpts: [excerpt] };
const library: ResearchLibrary = { version: 1, collections: [collection] };

describe("research collections", () => {
  it("roundtrips source snapshots and exports escaped text with durable local citations", () => {
    expect(decodeResearch(JSON.stringify(library))).toEqual(library);
    const output = exportResearch(
      { ...collection, excerpts: [{ ...excerpt, note: "核对结果" }] },
      "https://example.org",
    );
    expect(output).toContain("https://example.org/reader?book=b&section=s&start=0");
    expect(output).toContain("真实原文");
    expect(output).toContain("核对结果");
    expect(output).toContain("&lt;script&gt;");
    expect(output).not.toContain("<script>");
  });
  it("rejects malformed libraries and remote or executable source routes", () => {
    for (const route of [
      "//evil.test/reader",
      "/reader\\evil",
      "/reader?book=\nfoo",
      "javascript:alert(1)",
      "https://evil.test/reader",
      "/studio",
    ])
      expect(citationRoute(route)).toBeUndefined();
    expect(() => decodeResearch('{"version":2,"collections":[]}')).toThrow();
    expect(() =>
      decodeResearch(JSON.stringify({ ...library, collections: [collection, collection] })),
    ).toThrow();
    expect(() =>
      decodeResearch(
        JSON.stringify({
          ...library,
          collections: [{ ...collection, excerpts: [{ ...excerpt, route: "//evil.test" }] }],
        }),
      ),
    ).toThrow();
  });
  it("serializes concurrent edits and restores all successful writes", async () => {
    let raw: string | undefined;
    const metadata = {
      get: async () => raw,
      set: async (_: string, value: string) => {
        await Promise.resolve();
        raw = value;
      },
    };
    const store = new ResearchStore(metadata);
    await store.ready;
    await Promise.all(
      ["one", "two"].map((id) =>
        store.update((current) => ({
          ...current,
          collections: [...current.collections, { id, name: id, excerpts: [] }],
        })),
      ),
    );
    const restored = new ResearchStore(metadata);
    await restored.ready;
    expect(restored.getSnapshot().collections.map((item) => item.id)).toEqual(["one", "two"]);
  });
  it("does not publish failed writes and permits retry without losing earlier data", async () => {
    let fail = true;
    let raw = JSON.stringify(library);
    const store = new ResearchStore({
      get: async () => raw,
      set: async (_, value) => {
        if (fail) throw new Error("disk full");
        raw = value;
      },
    });
    await store.ready;
    const change = (current: ResearchLibrary): ResearchLibrary => ({
      ...current,
      collections: [...current.collections, { id: "two", name: "新集合", excerpts: [] }],
    });
    await expect(store.update(change)).rejects.toThrow("disk full");
    expect(store.getSnapshot()).toEqual(library);
    fail = false;
    await store.update(change);
    expect(decodeResearch(raw).collections).toHaveLength(2);
  });
  it("cannot overwrite unreadable persisted data", async () => {
    let writes = 0;
    const store = new ResearchStore({
      get: async () => "broken",
      set: async () => {
        writes += 1;
      },
    });
    await expect(store.ready).rejects.toThrow();
    await expect(store.update(() => library)).rejects.toThrow();
    expect(writes).toBe(0);
  });
});

it("saves the hit sentence, retains legacy excerpts, and reports honest source states", async () => {
  const { createSearchIndex, textVersion } = await import("@bcr/core");
  const { excerptFromResult, assessExcerpt, sameExcerpt } = await import("../src/research");
  const index = createSearchIndex();
  const body = "前文。第一份证据。中间。第一份证据。结尾。";
  const current = {
    ...document,
    body,
    citation: { scope: "chapter", unit: "chapter", offset: 0, version: textVersion(body) },
  };
  index.replaceSource("reader", [current]);
  const results = index.search("证据");
  const first = excerptFromResult(results[0]!, 1000);
  const second = excerptFromResult(results[1]!, 1000);
  expect(first.text).toBe("第一份证据。");
  expect(sameExcerpt(first, second)).toBe(false);
  expect(sameExcerpt(first, excerptFromResult(results[0]!, 1001))).toBe(true);
  expect(assessExcerpt(first, index).state).toBe("exact");
  const changed = "插入。" + body;
  index.replaceSource("reader", [
    { ...current, body: changed, citation: { ...current.citation, version: textVersion(changed) } },
  ]);
  expect(assessExcerpt(first, index).state).toBe("relocated");
  index.replaceSource("reader", []);
  expect(assessExcerpt(first, index).state).toBe("missing");
  expect(assessExcerpt(excerpt, index).state).toBe("unverified");
  expect(
    decodeResearch(
      JSON.stringify({ version: 1, collections: [{ ...collection, excerpts: [excerpt, first] }] }),
    ).collections[0]!.excerpts,
  ).toHaveLength(2);
});
