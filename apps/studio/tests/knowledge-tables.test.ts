import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { knowledgeMarkdownLanguage } from "../src/knowledge/editor/markdownEditor";
import { tableAt } from "../src/knowledge/editor/markdownTables";
import { tableAction, type TableAction } from "../src/knowledge/editor/tableCommands";

const stateFor = (doc: string, anchor = 0) =>
  EditorState.create({ doc, selection: { anchor }, extensions: [knowledgeMarkdownLanguage] });
function edit(doc: string, anchor: number, action: TableAction) {
  const state = stateFor(doc, anchor);
  const table = tableAt(state)!;
  const spec = tableAction(state, table, action)!;
  return state.update(spec).state.doc.toString();
}
describe("direct Markdown tables", () => {
  it("locates empty and escaped cells without shifting columns or dropping padding", () => {
    const source = "| A | B | C |\n| :--- | ---: | :---: |\n| x\\|y || `z` |";
    const state = stateFor(source);
    const table = tableAt(state)!;
    expect(table.align).toEqual(["left", "right", "center"]);
    expect(table.rows[1]!.cells.map((cell) => state.sliceDoc(cell.from, cell.to))).toEqual([
      "x\\|y",
      "",
      "`z`",
    ]);
    expect(table.rows[1]!.cells.map((cell) => state.sliceDoc(cell.start, cell.end))).toEqual([
      " x\\|y ",
      "",
      " `z` ",
    ]);
  });
  it("changes only the selected alignment marker", () => {
    const source = "Before\n\n| A | B |\n| --- | ----: |\n| x | y |\n\nAfter";
    expect(edit(source, source.indexOf("y"), "center")).toBe(source.replace("----:", ":----:"));
    expect(edit(source, source.indexOf("y"), "left")).toBe(source.replace("----:", ":----"));
  });
  it("adds and removes only the addressed column, leaving other Markdown exact", () => {
    const source = "a | **b**\n--- | :----:\nx | y\n\nAfter";
    expect(edit(source, 0, "add-column")).toBe(
      "a |  | **b**\n--- | --- | :----:\nx |  | y\n\nAfter",
    );
    const withOuter = "| a | **b** | c |\n| --- | :----: | --- |\n| x | y | z |\n\nAfter";
    expect(edit(withOuter, withOuter.indexOf("y"), "remove-column")).toBe(
      "| a | c |\n| --- | --- |\n| x | z |\n\nAfter",
    );
    expect(edit(withOuter, withOuter.indexOf("x"), "remove-column")).toBe(
      "| **b** | c |\n| :----: | --- |\n| y | z |\n\nAfter",
    );
  });
  it("adds nested rows with the original container prefix", () => {
    const source = "> | A | B |\n> | --- | --- |\n> | x | y |\n\nAfter";
    expect(edit(source, source.indexOf("y"), "add-row")).toBe(
      source.replace("y |", "y |\n> |  |  |"),
    );
    const list = "- | A | B |\n  | --- | --- |\n  | x | y |";
    expect(edit(list, list.indexOf("y"), "add-row")).toBe(list + "\n  |  |  |");
    expect(edit(list, list.indexOf("A"), "add-row")).toBe(
      list.replace("  | x", "  |  |  |\n  | x"),
    );
  });
  it("removes a body row and protects the header and last column", () => {
    const source = "| A |\n| --- |\n| x |\n| y |";
    expect(edit(source, source.indexOf("x"), "remove-row")).toBe(source.replace("\n| x |", ""));
    const state = stateFor(source, 2),
      table = tableAt(state)!;
    expect(tableAction(state, table, "remove-row")).toBeNull();
    expect(tableAction(state, table, "remove-column")).toBeNull();
  });
  it("keeps single-column and ragged tables valid after structural edits", () => {
    const source = "a | b\n--- | ---\nx | y";
    for (const anchor of [0, source.indexOf("y")]) {
      const changed = edit(source, anchor, "remove-column");
      const table = tableAt(stateFor(changed));
      expect(table?.align).toHaveLength(1);
      expect(table?.rows).toHaveLength(2);
    }
    const ragged = "| A | B |\n| --- | --- |\n| x |";
    const changed = edit(ragged, ragged.indexOf("B"), "add-column");
    expect(changed).toBe("| A | B |  |\n| --- | --- | --- |\n| x |  |  |");
    expect(tableAt(stateFor(changed))?.rows[1]?.cells).toHaveLength(3);
    const emptyRow = "| A | B |\n| --- | --- |\n|\n| x | y |";
    expect(
      tableAt(stateFor(edit(emptyRow, emptyRow.indexOf("B"), "add-column")))?.align,
    ).toHaveLength(3);
    expect(edit(emptyRow, emptyRow.indexOf("x"), "remove-row")).toBe("| A | B |\n| --- | --- |\n|");
    const padded = "| A | B | \n| --- | --- |\n| x | y |  ";
    expect(tableAt(stateFor(padded))?.rows.map((row) => row.cells.length)).toEqual([2, 2]);
    expect(edit(padded, padded.indexOf("y"), "add-column")).toBe(
      padded
        .replace("B |", "B |  |")
        .replace("| --- | --- |", "| --- | --- | --- |")
        .replace("y |", "y |  |"),
    );
  });
});
