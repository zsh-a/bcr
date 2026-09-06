import { describe, expect, it } from "vitest";
import { textVersion } from "../src/citation";
import { createSearchIndex, type SearchDocument, type SearchQueryOptions } from "../src/search";

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
  it("matches exhaustive ranking with ties, repeated citations, Unicode and filters", () => {
    const index = createSearchIndex();
    const documents = Array.from({ length: 48 }, (_, i) => {
      const body = [
        "alpha beta alpha beta",
        "ＡＬＰＨＡ\t beta e\u0301 👩‍💻 中文",
        "beta only",
        "alpha and then beta",
        "ﬃ f ffi",
        "metadata only",
      ][i % 6]!;
      return {
        ...document(
          `rank-${i}`,
          i % 4 === 0 ? "alpha beta" : "Same title",
          body,
          i % 3 ? "reader-section" : "file",
        ),
        source: i % 2 ? "reader" : "document",
        updatedAt: i % 3,
        ...(i % 3
          ? {
              citation: {
                scope: `source-${i}`,
                version: textVersion(body),
                unit: "section",
                offset: 300,
              },
            }
          : {}),
      };
    });
    documents.forEach((item) => index.upsert(item));
    for (const query of ["alpha beta", "ＡＬＰＨＡ", "é", "中文", "f", "Same title"]) {
      for (const options of [
        { limit: 1 },
        { limit: 7 },
        { limit: 40, sources: ["reader"] },
        { limit: 12, kinds: ["file"] },
      ] satisfies SearchQueryOptions[]) {
        // Evaluate every document independently, then rank every emitted hit. This
        // deliberately bypasses cross-document candidate pruning.
        const exhaustive = documents
          .flatMap((item) => {
            const single = createSearchIndex();
            single.upsert(item);
            return single.search(query, options);
          })
          .sort(
            (left, right) =>
              right.score - left.score ||
              right.document.updatedAt - left.document.updatedAt ||
              left.document.title.localeCompare(right.document.title),
          )
          .slice(0, options.limit);
        expect(index.search(query, options)).toEqual(exhaustive);
      }
    }
  });

  it("refreshes normalized fields on updates, replacements, deletion and restore", async () => {
    const index = createSearchIndex();
    index.upsert(document("one", "Old title", "old body"));
    index.upsert(document("one", "New title", "new body"));
    expect(index.search("old")).toEqual([]);
    expect(index.search("new")).toHaveLength(1);
    index.replaceSource("test", [document("two", "Replacement", "different")]);
    expect(index.search("new")).toEqual([]);
    index.remove("two");
    expect(index.search("different")).toEqual([]);
    const restored = createSearchIndex({
      load: async () =>
        JSON.stringify({
          version: 1,
          documents: [document("three", "ＦＵＬＬＷＩＤＴＨ", "恢复正文")],
        }),
      save: async () => {},
    });
    await restored.ready;
    expect(restored.search("fullwidth")[0]?.document.id).toBe("three");
    restored.removeSource("test");
    expect(restored.search("恢复")).toEqual([]);
  });

  it("bounds malformed and extreme result limits", () => {
    const index = createSearchIndex();
    index.replaceSource(
      "test",
      Array.from({ length: 250 }, (_, i) => document(`${i}`, "alpha", "body")),
    );
    expect(index.search("alpha", { limit: NaN })).toHaveLength(40);
    expect(index.search("alpha", { limit: Infinity })).toHaveLength(200);
    expect(index.search("alpha", { limit: -1 })).toHaveLength(1);
    expect(index.search("alpha", { limit: 2.8 })).toHaveLength(2);
  });
});
