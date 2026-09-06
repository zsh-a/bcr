import { describe, expect, it } from "vitest";
import { createSearchIndex } from "../src/search";
import {
  createTextCitation,
  decodeTextCitation,
  findTextMatches,
  resolveTextCitation,
  textVersion,
  type CitationSource,
} from "../src/citation";

function source(text: string, unit = "chapter"): CitationSource {
  return { scope: "book", unit, version: textVersion(text), offset: 0 };
}
function anchor(text: string, query: string, ordinal = 0) {
  return createTextCitation(text, source(text), findTextMatches(text, query)[ordinal]!);
}

describe("source-aware citations", () => {
  it("maps fullwidth characters, whitespace, combining marks and ligatures to original UTF-16", () => {
    const text = "🦊 开头 Ａ\t \nＢ，cafe\u0301，ﬃ。";
    for (const [query, exact] of [
      ["a b", "Ａ\t \nＢ"],
      ["café", "cafe\u0301"],
      ["ffi", "ﬃ"],
    ]) {
      const range = findTextMatches(text, query!)[0]!;
      expect(text.slice(range.start, range.end)).toBe(exact);
      const citation = createTextCitation(text, source(text), range);
      expect(citation.exact.slice(citation.hit.start, citation.hit.end)).toBe(exact);
      expect(decodeTextCitation(citation)).toEqual(citation);
    }
  });
  it("keeps repeated occurrences distinct and honors their saved positions in unchanged sources", () => {
    const text = "第一处。相同证据。第二处。相同证据。";
    const citation = anchor(text, "相同证据", 1);
    const result = resolveTextCitation(citation, [{ text, source: source(text) }]);
    expect(result.status).toBe("exact");
    if ("hit" in result) expect(result.hit.start).toBe(text.lastIndexOf("相同证据"));
  });
  it("relocates a quote after text insertion using its surrounding context", () => {
    const original = "开篇。第一处。相同证据。第二处。相同证据。结尾。";
    const citation = anchor(original, "相同证据", 1);
    const text = "新增序言。" + original;
    const result = resolveTextCitation(citation, [{ text, source: source(text) }]);
    expect(result.status).toBe("relocated");
    if ("hit" in result) expect(result.hit.start).toBe(text.lastIndexOf("相同证据"));
  });
  it("does not choose a nearby duplicate when the source changed and context cannot disambiguate", () => {
    const original = "相同证据。";
    const citation = anchor(original, "相同证据");
    const text = original + original;
    expect(resolveTextCitation(citation, [{ text, source: source(text) }]).status).toBe(
      "ambiguous",
    );
    expect(
      resolveTextCitation(citation, [{ text: "正文已被删除", source: source("正文已被删除") }])
        .status,
    ).toBe("changed");
    expect(resolveTextCitation(citation, []).status).toBe("missing");
  });
  it("maps the highlighted subrange after normalized text changes", () => {
    const original = "开始。前缀 Ａ\tＢ cafe\u0301 后缀。结束。";
    const citation = anchor(original, "café");
    const text = "插入。开始。前缀 A B café 后缀。结束。";
    const result = resolveTextCitation(citation, [{ text, source: source(text) }]);
    expect(result.status).toBe("relocated");
    if ("hit" in result) expect(text.slice(result.hit.start, result.hit.end)).toBe("café");
  });
  it("reassembles overlapping projections when a quote crosses a new chunk boundary", () => {
    const original = "前文。" + "文字".repeat(200) + "证据结论。后文。";
    const citation = anchor(original, "证据结论");
    const text = "插入。" + original;
    const currentSource = source(text);
    const result = resolveTextCitation(citation, [
      { text: text.slice(0, 330), source: currentSource },
      { text: text.slice(300), source: { ...currentSource, offset: 300 } },
    ]);
    expect(result.status).toBe("relocated");
    if ("hit" in result) expect(text.slice(result.hit.start, result.hit.end)).toBe("证据结论");
  });
  it("rejects malformed citation ranges and does not equate different source identities", () => {
    const citation = anchor("一段证据。", "证据");
    expect(decodeTextCitation({ ...citation, hit: { start: -1, end: 5 } })).toBeUndefined();
    expect(
      decodeTextCitation({ ...citation, source: { ...citation.source, offset: NaN } }),
    ).toBeUndefined();
    expect(
      resolveTextCitation(citation, [
        { text: "一段证据。", source: { ...citation.source, scope: "another book" } },
      ]).status,
    ).toBe("missing");
  });
  it("enumerates every original-text match and persists source versions without claiming liveness", async () => {
    let raw: string | undefined;
    const persistence = {
      load: async () => raw,
      save: async (value: string) => {
        raw = value;
      },
    };
    const index = createSearchIndex(persistence);
    await index.ready;
    const text = "Ａ\nＢ。再次 A B。";
    const document = {
      id: "doc",
      title: "chapter",
      source: "reader",
      kind: "reader-section" as const,
      body: text,
      citation: source(text),
      updatedAt: 1,
    };
    index.replaceSource("reader", [document]);
    expect(
      index.search("a b").map((result) => text.slice(result.match!.start, result.match!.end)),
    ).toEqual(["Ａ\nＢ", "A B"]);
    expect(index.isSourceLive("reader")).toBe(true);
    await index.close();
    const restored = createSearchIndex(persistence);
    await restored.ready;
    expect(restored.isSourceLive("reader")).toBe(false);
    expect(restored.documents()[0]!.citation).toEqual(document.citation);
    await restored.close();
  });
});
