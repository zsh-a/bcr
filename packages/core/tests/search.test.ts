import { describe, expect, it } from "vitest";
import { createSearchIndex, type SearchDocument } from "../src/search";

const document = (
  id: string,
  title: string,
  body: string,
  kind: SearchDocument["kind"] = "file",
): SearchDocument => ({
  id,
  source: "test",
  kind,
  title,
  body,
  updatedAt: Number(id.replace(/\D/gu, "")) || 1,
});

describe("workspace search index", () => {
  it("matches CJK and Latin terms, ranks title hits, and emits snippets", async () => {
    const index = createSearchIndex();
    await index.ready;
    index.replaceSource("test", [
      document("doc-1", "阅读空间", "把时间还给阅读，搜索应该回到内容。", "reader-book"),
      document(
        "doc-2",
        "Market Atlas",
        "Global market instruments and dividends.",
        "market-instrument",
      ),
    ]);

    const reader = index.search("阅读");
    expect(reader).toHaveLength(1);
    expect(reader[0]?.document.id).toBe("doc-1");
    expect(reader[0]?.snippet).toContain("阅读");

    const market = index.search("market", { kinds: ["market-instrument"] });
    expect(market).toHaveLength(1);
    expect(market[0]?.document.id).toBe("doc-2");
    expect(index.search("market", { kinds: ["reader-book"] })).toEqual([]);
  });

  it("replaces a source atomically from the caller's perspective and removes stale docs", async () => {
    const index = createSearchIndex();
    await index.ready;
    index.replaceSource("reader", [document("reader-1", "First", "alpha")]);
    expect(index.search("alpha")).toHaveLength(1);
    index.replaceSource("reader", [document("reader-2", "Second", "beta")]);
    expect(index.search("alpha")).toEqual([]);
    expect(index.search("beta")[0]?.document.id).toBe("reader-2");
  });

  it("restores valid persisted documents and ignores malformed entries", async () => {
    let saved = "";
    const index = createSearchIndex({
      load: async () =>
        JSON.stringify({
          version: 1,
          documents: [
            document("persisted", "Persisted file", "hello"),
            { id: "bad", title: "missing fields" },
          ],
        }),
      save: async (value) => {
        saved = value;
      },
    });
    await index.ready;
    expect(index.search("persisted")[0]?.document.id).toBe("persisted");
    index.upsert(document("new", "New file", "world"));
    await index.flush();
    expect(JSON.parse(saved)).toMatchObject({ version: 1 });
    expect(JSON.parse(saved).documents).toHaveLength(2);
  });
});
