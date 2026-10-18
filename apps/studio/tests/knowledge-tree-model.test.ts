import { describe, expect, it } from "vitest";
import { newNote } from "../src/knowledge/session/model";
import { buildNoteTree, visibleNoteRows } from "../src/knowledge/workbench/noteTreeModel";
const note = (id: string, path: string, title = id) => ({ ...newNote(title), id, path });

describe("visible knowledge tree rows", () => {
  it("sorts folders before notes and keeps nested path, depth and sibling semantics", () => {
    const root = buildNoteTree(
      [note("z", "work/sub/z.md"), note("a", "a.md"), note("b", "b.md")],
      ["empty", "work/sub"],
    );
    const rows = visibleNoteRows(root, []);
    expect(rows.map((row) => [row.key, row.depth])).toEqual([
      ["folder:empty", 0],
      ["folder:work", 0],
      ["folder:work/sub", 1],
      ["note:z", 2],
      ["note:a", 0],
      ["note:b", 0],
    ]);
    expect(rows[3]).toMatchObject({ parent: "work/sub", position: 1, siblings: 1 });
    expect(rows[4]).toMatchObject({ parent: "", position: 3, siblings: 4 });
  });
  it("does not build or mount descendants of collapsed branches in a 5000 note library", () => {
    const notes = Array.from({ length: 5000 }, (_, i) => note(`n${i}`, `work/sub/${i}.md`));
    const root = buildNoteTree(notes, ["empty"]);
    expect(visibleNoteRows(root, ["WORK"]).map((row) => row.key)).toEqual([
      "folder:empty",
      "folder:work",
    ]);
    expect(visibleNoteRows(root, ["work/sub"]).map((row) => row.key)).toEqual([
      "folder:empty",
      "folder:work",
      "folder:work/sub",
    ]);
    expect(visibleNoteRows(root, [])).toHaveLength(5003);
  });
  it("preserves explicit empty folders, case-insensitive paths and editor placement", () => {
    const root = buildNoteTree([note("child", "Work/n.md")], ["work/Empty"]);
    const created = visibleNoteRows(root, [], { kind: "create", parent: "Work", path: "" });
    expect(created.filter((row) => row.kind === "folder")).toHaveLength(2);
    expect(created[1]).toMatchObject({ kind: "edit", parent: "Work", initial: "", depth: 1 });
    const renamed = visibleNoteRows(root, [], { kind: "rename", parent: "", path: "Work" });
    expect(renamed).toHaveLength(1);
    expect(renamed[0]).toMatchObject({ kind: "edit", initial: "Work" });
  });
});
