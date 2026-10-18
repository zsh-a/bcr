import { syntaxTree } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";
import { IterMode, type SyntaxNode } from "@lezer/common";

export interface TableCell {
  from: number;
  to: number;
  start: number;
  end: number;
}
export interface TableRow {
  from: number;
  to: number;
  cells: TableCell[];
  prefix: string;
}
export interface MarkdownTable {
  from: number;
  to: number;
  rows: TableRow[];
  separator: { from: number; to: number; cells: TableCell[] };
  align: ("left" | "center" | "right")[];
}
function cells(state: EditorState, from: number, to: number, pipes: number[]) {
  const boundaries = [from - 1, ...pipes, to];
  if (pipes.length && !state.sliceDoc(from, pipes[0]!).trim()) boundaries.shift();
  if (pipes.length && !state.sliceDoc(pipes.at(-1)! + 1, to).trim()) boundaries.pop();
  if (boundaries.length < 2) return [{ start: to, end: to, from: to, to }];
  return boundaries.slice(0, -1).map((left, i) => {
    const start = left + 1,
      end = boundaries[i + 1]!;
    const text = state.sliceDoc(start, end);
    const first = text.match(/^[ \t]*/u)![0].length;
    const last = text.trimEnd().length;
    return { start, end, from: start + first, to: start + Math.max(first, last) };
  });
}
export function readTable(state: EditorState, node: SyntaxNode): MarkdownTable | null {
  if (node.name !== "Table") return null;
  const rows: TableRow[] = [];
  let separator: MarkdownTable["separator"] | undefined;
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.name === "TableHeader" || child.name === "TableRow") {
      const pipes = child.getChildren("TableDelimiter").map((n) => n.from);
      rows.push({
        from: child.from,
        to: child.to,
        cells: cells(state, child.from, child.to, pipes),
        prefix: state.sliceDoc(state.doc.lineAt(child.from).from, child.from),
      });
    } else if (child.name === "TableDelimiter") {
      const text = state.sliceDoc(child.from, child.to);
      const pipes = [...text.matchAll(/\|/gu)].map((m) => child.from + m.index);
      separator = {
        from: child.from,
        to: child.to,
        cells: cells(state, child.from, child.to, pipes),
      };
    }
  }
  if (!separator || !rows.length || !separator.cells.length) return null;
  const align = separator.cells.map((cell) => {
    const raw = state.sliceDoc(cell.from, cell.to);
    return raw.endsWith(":") ? (raw.startsWith(":") ? "center" : "right") : "left";
  });
  return { from: node.from, to: node.to, rows, separator, align };
}
export function tableAt(state: EditorState, pos = state.selection.main.head) {
  for (const bias of [-1, 1] as const) {
    let node: SyntaxNode | null = syntaxTree(state)
      .cursor(IterMode.IgnoreMounts)
      .moveTo(pos, bias).node;
    for (; node; node = node.parent) if (node.name === "Table") return readTable(state, node);
  }
  return null;
}
export function tablePosition(table: MarkdownTable, pos: number) {
  let row = table.rows.findIndex((r) => pos >= r.from && pos <= r.to);
  if (row < 0) row = 0;
  const cells = table.rows[row]!.cells;
  let column = cells.findIndex((c) => pos >= c.start && pos <= c.end);
  if (column < 0) column = cells.findLastIndex((c) => c.start <= pos);
  return { row, column: Math.max(0, Math.min(table.align.length - 1, column)) };
}
