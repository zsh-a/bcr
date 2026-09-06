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
