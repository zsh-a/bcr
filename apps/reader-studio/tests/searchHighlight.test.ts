import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { highlightText } from "../src/searchHighlight";

describe("source-relative page highlighting", () => {
  it("keeps both halves of a match spanning a page boundary", () => {
    const source = "前文跨页命中后文";
    expect(renderToStaticMarkup(highlightText(source, "跨页命中", 0, 4))).toBe(
      '前文<mark data-reader-search-match="true">跨页</mark>',
    );
    expect(renderToStaticMarkup(highlightText(source, "跨页命中", 4))).toBe(
      '<mark data-reader-search-match="true">命中</mark>后文',
    );
  });
  it("clips source matches without changing escaping or plain-text output", () => {
    expect(renderToStaticMarkup(highlightText("<script>正文", "<script>", 0, 4))).toBe(
      '<mark data-reader-search-match="true">&lt;scr</mark>',
    );
    expect(renderToStaticMarkup(highlightText("前文后文", "", 2))).toBe("后文");
    expect(renderToStaticMarkup(highlightText("前文后文", "后文", 0, 2))).toBe("前文");
  });
});
