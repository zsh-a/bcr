import { describe, expect, it } from "vitest";
import { analyzeMarkdown, KnowledgeLinkIndex } from "../src/knowledge/markdownAnalysis";
import { preserveRenamedLinks } from "../src/knowledge/renameLinks";
import { newNote } from "../src/knowledge/model";

const target = { ...newNote("旧标题"), id: "target" };
function rename(body: string) {
  const source = { ...newNote("来源"), id: "source", body };
  const before = { target, source };
  return preserveRenamedLinks(
    before,
    { ...before, target: { ...target, title: "新标题" } },
    "target",
  ).source!.body;
}
describe("reference-style knowledge links", () => {
  it("recognizes full, collapsed and shortcut references with normalized labels", () => {
    const body = '[完整][REF] [ref][] [ref]\n\n[ref]: 旧标题.md#章节 "提示"';
    const links = analyzeMarkdown(body).links;
    expect(links.map((link) => link.target)).toEqual(Array(3).fill("旧标题#章节"));
    expect(links.map((link) => body.slice(link.from, link.to))).toEqual([
      "[完整][REF]",
      "[ref][]",
      "[ref]",
    ]);
    expect(links[0]!.reference).toEqual({ label: "完整", title: "提示" });
  });
  it("uses the first definition, ignores undefined, image, external and code references", () => {
    const body =
      "[ref] [missing] ![ref] `[ref]` [web]\n\n[ref]: 旧标题.md\n[ref]: other.md\n[web]: https://example.com";
    expect(analyzeMarkdown(body).links.map((link) => link.target)).toEqual(["旧标题"]);
  });
  it("indexes references as backlinks but not unused definitions", () => {
    const source = { ...newNote("来源"), id: "source", body: "[ref]\n\n[ref]: 旧标题.md" };
    const unused = { ...source, id: "unused", body: "[ref]: 旧标题.md" };
    const notes = [target, source, unused],
      index = new KnowledgeLinkIndex();
    index.update(notes);
    expect(index.backlinks(notes, "target")).toEqual([source]);
  });
  it("detaches textual references without altering images or shared definitions", () => {
    const body = '[**显示**][ref] [ref][] [ref] ![图片][ref]\n\n[ref]: <旧标题.md#章节> "提示"';
    expect(rename(body)).toBe(
      '[**显示**](target.md#%E7%AB%A0%E8%8A%82 "提示") [ref](target.md#%E7%AB%A0%E8%8A%82 "提示") [ref](target.md#%E7%AB%A0%E8%8A%82 "提示") ![图片][ref]\n\n[ref]: <旧标题.md#章节> "提示"',
    );
  });
  it("preserves escaped titles, empty labels, nested labels and multiline definitions", () => {
    const body =
      "[][ref] [![图片](image.png)][ref]\n\n[ref]:\n  旧标题.md\n  'say \"hi\" and \\\\ path'";
    const next = rename(body);
    expect(next).toContain('[](target.md "say \\"hi\\" and \\\\ path")');
    expect(next).toContain("[![图片](image.png)](target.md");
    expect(analyzeMarkdown(next).links.map((link) => link.target)).toEqual(["target", "target"]);
  });
  it("does not change escaped references or unresolved definitions", () => {
    const body = "\\[ref] [missing]\n\n[ref]: 旧标题.md";
    expect(rename(body)).toBe(body);
  });
});
