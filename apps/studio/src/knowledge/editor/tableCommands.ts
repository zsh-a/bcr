import { EditorSelection, Prec, type EditorState, type TransactionSpec } from "@codemirror/state";
import { keymap, type EditorView } from "@codemirror/view";
import { tableAt, tablePosition, type MarkdownTable } from "./markdownTables";
import { liveComposition } from "./liveSelection";

export type TableAction =
  | "add-row"
  | "remove-row"
  | "add-column"
  | "remove-column"
  | "left"
  | "center"
  | "right";
const blankRow = (table: MarkdownTable, prefix: string) =>
  prefix + "|" + "  |".repeat(table.align.length);
function newRow(table: MarkdownTable, row: number) {
  const source = table.rows[Math.max(1, row)] ?? table.rows[0]!;
  // Continuation rows in a list use the separator's indentation, not the list marker.
  const prefix = source.prefix.replace(/([-+*]|\d+[.)])\s/u, (m) => " ".repeat(m.length));
  const at = row === 0 ? table.separator.to : table.rows[row]!.to;
  return { at, text: "\n" + blankRow(table, prefix), prefix };
}
export function tableAction(
  state: EditorState,
  table: MarkdownTable,
  action: TableAction,
): TransactionSpec | null {
  const { row, column } = tablePosition(table, state.selection.main.head);
  if (action === "add-row") {
    const next = newRow(table, row);
    return {
      changes: { from: next.at, insert: next.text },
      selection: { anchor: next.at + 1 + next.prefix.length + 2 },
    };
  }
  if (action === "remove-row") {
    if (row === 0) return null;
    const target = table.rows[row]!;
    return {
      changes: { from: state.doc.lineAt(target.from).from - 1, to: target.to },
      selection: { anchor: table.rows[row - 1]!.cells[0]!.from },
    };
  }
  if (action === "left" || action === "center" || action === "right") {
    const cell = table.separator.cells[column]!;
    const raw = state.sliceDoc(cell.from, cell.to).replace(/:/gu, "");
    return {
      changes: {
        from: cell.from,
        to: cell.to,
        insert: (action !== "right" ? ":" : "") + raw + (action !== "left" ? ":" : ""),
      },
    };
  }
  if (action === "remove-column" && table.align.length === 1) return null;
  const rows = [...table.rows, table.separator];
  const changes = rows.map((target) => {
    const cell = target.cells[column];
    if (action === "add-column") {
      const trailing = target.cells.at(-1)!.end < target.to;
      const at = cell?.end ?? (trailing ? target.cells.at(-1)!.end : target.to);
      const missing = Math.max(0, column + 1 - target.cells.length);
      return {
        from: at,
        insert: "|  ".repeat(missing) + (target === table.separator ? "| --- " : "|  "),
      };
    }
    if (!cell) return { from: target.to, insert: "" };
    const change =
      column === 0
        ? { from: cell.start, to: target.cells[1]?.start ?? cell.end }
        : { from: cell.start - 1, to: cell.end };
    // A one-column GFM table needs an outer pipe to remain a table.
    if (table.align.length === 2) {
      const left = target.cells[0]!.start > target.from;
      const right = target.cells.at(-1)!.end < target.to;
      return {
        from: target.from,
        to: target.to,
        insert:
          (left ? "" : "|") +
          state.sliceDoc(target.from, change.from) +
          state.sliceDoc(change.to, target.to) +
          (right ? "" : "|"),
      };
    }
    return change;
  });
  return { changes };
}
export function selectTableCell(
  view: EditorView,
  table: MarkdownTable,
  row: number,
  column: number,
) {
  const target = table.rows[row]!;
  const cell = target.cells[column];
  if (cell) {
    view.dispatch({ selection: EditorSelection.range(cell.from, cell.to), scrollIntoView: true });
  } else {
    const last = target.cells.at(-1)!;
    const at = last.end < target.to ? last.end : target.to;
    const insert = "|  ".repeat(column + 1 - target.cells.length);
    view.dispatch({
      changes: { from: at, insert },
      selection: { anchor: at + insert.length },
      userEvent: "input",
    });
  }
  return true;
}
function navigate(view: EditorView, backwards: boolean, vertical = false) {
  if (view.compositionStarted || view.state.field(liveComposition, false)) return false;
  const table = tableAt(view.state);
  if (!table || view.state.readOnly) return false;
  const position = tablePosition(table, view.state.selection.main.head);
  const selection = view.state.selection.main,
    cell = table.rows[position.row]!.cells[position.column];
  if (!selection.empty && (!cell || selection.from < cell.start || selection.to > cell.end))
    return false;
  const index = position.row * table.align.length + position.column + (backwards ? -1 : 1);
  const row = vertical ? position.row + 1 : Math.floor(index / table.align.length);
  const column = vertical ? position.column : (index + table.align.length) % table.align.length;
  if (row < 0) {
    view.dispatch({
      selection: { anchor: Math.max(0, view.state.doc.lineAt(table.from).from - 1) },
    });
    return true;
  }
  if (row < table.rows.length) return selectTableCell(view, table, row, column);
  const next = newRow(table, table.rows.length - 1);
  view.dispatch({
    changes: { from: next.at, insert: next.text },
    selection: { anchor: next.at + 1 + next.prefix.length + 2 + column * 3 },
    userEvent: "input",
  });
  return true;
}
export const tableEditingKeys = (enabled: () => boolean) =>
  Prec.high(
    keymap.of([
      {
        key: "Mod-Enter",
        run: (view) => {
          if (
            !enabled() ||
            view.state.readOnly ||
            view.compositionStarted ||
            view.state.field(liveComposition, false)
          )
            return false;
          const table = tableAt(view.state);
          if (!table) return false;
          const selection = view.state.selection.main,
            position = tablePosition(table, selection.head),
            cell = table.rows[position.row]!.cells[position.column];
          if (!selection.empty && (!cell || selection.from < cell.start || selection.to > cell.end))
            return false;
          const exists = view.state.sliceDoc(table.to, table.to + 2) === "\n\n";
          view.dispatch({
            ...(exists ? {} : { changes: { from: table.to, insert: "\n\n" } }),
            selection: { anchor: table.to + 2 },
            scrollIntoView: true,
            userEvent: "input",
          });
          return true;
        },
      },
      {
        key: "Tab",
        run: (view) => enabled() && navigate(view, false),
        shift: (view) => enabled() && navigate(view, true),
      },
      { key: "Enter", run: (view) => enabled() && navigate(view, false, true) },
    ]),
  );
