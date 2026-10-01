import { describe, expect, it } from "vitest";
import type { ReaderTocItem } from "@bcr/reader-core";
import { tocAncestors, tocBranches, visibleTocRows } from "../src/tocTree";

const tree: readonly ReaderTocItem[] = [
  {
    id: "part-1",
    label: "第一部",
    children: [
      { id: "chapter-1", label: "初见", children: [{ id: "scene-1", label: "雨夜" }] },
      { id: "chapter-2", label: "告别" },
    ],
  },
  { id: "part-2", label: "第二部", children: [{ id: "chapter-3", label: "重逢" }] },
];

describe("hierarchical reader navigation", () => {
  it("retains original numbering when collapsing branches or filtering deeply nested chapters", () => {
    const collapsed = new Set(["part-1", "part-2"]);
    expect(visibleTocRows(tree, collapsed).map((row) => [row.item.id, row.ordinal])).toEqual([
      ["part-1", 1],
      ["part-2", 5],
    ]);
    expect(
      visibleTocRows(tree, collapsed, "雨夜").map((row) => [row.item.id, row.depth, row.ordinal]),
    ).toEqual([
      ["part-1", 0, 1],
      ["chapter-1", 1, 2],
      ["scene-1", 2, 3],
    ]);
    expect([...collapsed]).toEqual(["part-1", "part-2"]);
  });
  it("finds every ancestor to reveal the current chapter without opening unrelated branches", () => {
    expect(tocAncestors(tree, "scene-1")).toEqual(["part-1", "chapter-1"]);
    expect(tocAncestors(tree, "part-1")).toEqual([]);
    expect(tocAncestors(tree, "missing")).toEqual([]);
    expect(tocBranches(tree)).toEqual(["part-1", "chapter-1", "part-2"]);
  });
  it("returns an empty list for unmatched queries, including collapsed trees", () => {
    expect(visibleTocRows(tree, new Set(), "missing")).toEqual([]);
  });
});
