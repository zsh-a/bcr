import { EditorView, WidgetType } from "@codemirror/view";
import { tableAt, type MarkdownTable } from "./markdownTables";
import { selectTableCell, tableAction, type TableAction } from "./tableCommands";
import { runEditorEdit } from "./editorCommands";
import { liveComposition } from "./liveSelection";

export class TableToolsWidget extends WidgetType {
  constructor(
    private row: number,
    private column: number,
    private align: string,
    private readOnly: boolean,
    private columns: number,
  ) {
    super();
  }
  eq(other: TableToolsWidget) {
    return (
      this.row === other.row &&
      this.column === other.column &&
      this.align === other.align &&
      this.readOnly === other.readOnly &&
      this.columns === other.columns
    );
  }
  toDOM() {
    const root = document.createElement("span");
    root.className = "knowledge-table-tools";
    root.setAttribute("role", "group");
    root.setAttribute("aria-label", "表格操作");
    const act = (action: TableAction) => {
      const view = EditorView.findFromDOM(root);
      if (
        !view ||
        view.state.readOnly ||
        view.compositionStarted ||
        view.state.field(liveComposition, false)
      )
        return;
      const table = tableAt(view.state, view.posAtDOM(root));
      if (!table) return;
      const spec = tableAction(view.state, table, action);
      if (spec) runEditorEdit(view, { ...spec, userEvent: "input.format", scrollIntoView: true });
    };
    for (const [action, text, label] of [
      ["add-row", "+ 行", "在下方插入行"],
      ["remove-row", "− 行", "删除当前行"],
      ["add-column", "+ 列", "在右侧插入列"],
      ["remove-column", "− 列", "删除当前列"],
    ] as const) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = text;
      button.setAttribute("aria-label", label);
      button.disabled =
        this.readOnly ||
        (action === "remove-row" && this.row === 0) ||
        (action === "remove-column" && this.columns === 1);
      button.addEventListener("click", () => act(action));
      root.append(button);
    }
    const select = document.createElement("select");
    select.setAttribute("aria-label", "当前列对齐");
    for (const [value, label] of [
      ["left", "左对齐"],
      ["center", "居中"],
      ["right", "右对齐"],
    ])
      select.add(new Option(label, value));
    select.value = this.align;
    select.disabled = this.readOnly;
    select.addEventListener("change", () => act(select.value as TableAction));
    root.append(select);
    return root;
  }
  ignoreEvent() {
    return true;
  }
}

export class EmptyTableCellWidget extends WidgetType {
  constructor(
    private tableFrom: number,
    private row: number,
    private column: number,
    private missing: boolean,
  ) {
    super();
  }
  eq(other: EmptyTableCellWidget) {
    return (
      this.tableFrom === other.tableFrom &&
      this.row === other.row &&
      this.column === other.column &&
      this.missing === other.missing
    );
  }
  toDOM() {
    const cell = document.createElement("span");
    cell.className = "knowledge-table-cell knowledge-table-empty";
    cell.textContent = "\u200b";
    cell.setAttribute("aria-label", this.missing ? "补齐空单元格" : "空单元格");
    cell.addEventListener("mousedown", (event) => {
      const view = EditorView.findFromDOM(cell);
      if (
        !view ||
        view.state.readOnly ||
        view.compositionStarted ||
        view.state.field(liveComposition, false)
      )
        return;
      const table: MarkdownTable | null = tableAt(view.state, view.posAtDOM(cell));
      if (!table) return;
      event.preventDefault();
      selectTableCell(view, table, this.row, this.column);
      view.focus();
    });
    return cell;
  }
  ignoreEvent() {
    return true;
  }
}
