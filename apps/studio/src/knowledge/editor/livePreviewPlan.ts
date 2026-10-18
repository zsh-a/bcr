import { syntaxTree } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";
import { editorAnalysis, editorAttachments } from "./editorAnalysis";
import { touchesSyntax } from "./liveSelection";
import { IterMode } from "@lezer/common";
import { editorLinkAt } from "./editorContext";
import { readTable, tablePosition } from "./markdownTables";

export type LiveMark =
  | { kind: "hide"; from: number; to: number }
  | { kind: "bullet"; from: number; to: number; depth: number }
  | { kind: "ordinal"; from: number; to: number }
  | { kind: "task"; from: number; to: number; checked: boolean; marker: number }
  | { kind: "chip"; from: number; to: number; label: string; target: string }
  | { kind: "link-chip"; from: number; to: number; target: string }
  | { kind: "code"; from: number; to: number }
  | { kind: "code-tools"; from: number; language: string }
  | { kind: "table-row"; from: number; header: boolean; columns: number }
  | { kind: "table-cell"; from: number; to: number; align: string }
  | {
      kind: "table-empty";
      from: number;
      tableFrom: number;
      row: number;
      column: number;
      missing: boolean;
    }
  | {
      kind: "table-tools";
      from: number;
      to: number;
      row: number;
      column: number;
      align: string;
      columns: number;
    }
  | { kind: "line"; from: number; class: string };

export function listDepth(line: string, markFrom: number) {
  return Math.floor(
    line
      .slice(0, markFrom)
      .replace(/>[ \t]?/gu, "")
      .replace(/\t/gu, "  ").length / 2,
  );
}

/** Decorations never rewrite the Markdown, selection, or undo history. */
export function planLiveMarks(
  state: EditorState,
  focused: boolean,
  ranges?: readonly { from: number; to: number }[],
): LiveMark[] {
  const doc = state.doc,
    marks: LiveMark[] = [];
  const from = ranges?.[0]?.from ?? 0,
    to = ranges?.at(-1)?.to ?? doc.length;
  // Most typing needs only Lezer's incremental tree; semantic resolution is lazy.
  const wiki = doc.sliceString(from, to).includes("[[")
    ? editorAnalysis(state).links.filter(
        (link) => link.kind === "wiki" && link.from >= from && link.to <= to,
      )
    : [];
  const inWiki = (start: number, end: number) =>
    wiki.some((link) => start < link.to && end > link.from);
  const active = (start: number, end: number, edge = true) =>
    focused && touchesSyntax(state, start, end, edge);
  const lines = new Set<string>();
  const lineMark = (pos: number, className: string) => {
    const key = `${pos}:${className}`;
    if (!lines.has(key)) {
      lines.add(key);
      marks.push({ kind: "line", from: pos, class: className });
    }
  };
  const hide = (start: number, end: number) => {
    for (let pos = start; pos < end;) {
      const line = doc.lineAt(pos),
        until = Math.min(end, line.to);
      if (until > pos) marks.push({ kind: "hide", from: pos, to: until });
      pos = line.to + 1;
    }
  };
  syntaxTree(state).iterate({
    from,
    to,
    mode: IterMode.IgnoreMounts,
    enter(node) {
      if (node.name === "Table") {
        const table = readTable(state, node.node);
        if (
          !table ||
          table.align.length > 20 ||
          table.rows.some((row) => row.cells.length > table.align.length)
        )
          return false;
        const current = tablePosition(table, state.selection.main.head);
        if (table.separator.from >= from && table.separator.to <= to)
          marks.push({
            kind: "table-tools",
            ...table.separator,
            ...current,
            align: table.align[current.column]!,
            columns: table.align.length,
          });
        for (const [rowIndex, row] of table.rows.entries()) {
          if (row.to < from || row.from > to) continue;
          marks.push({
            kind: "table-row",
            from: doc.lineAt(row.from).from,
            header: rowIndex === 0,
            columns: table.align.length,
          });
          let end = row.from;
          for (const [column, cell] of row.cells.entries()) {
            hide(end, cell.start);
            if (cell.start < cell.end)
              marks.push({
                kind: "table-cell",
                from: cell.start,
                to: cell.end,
                align: table.align[column]!,
              });
            else
              marks.push({
                kind: "table-empty",
                from: cell.start,
                tableFrom: table.from,
                row: rowIndex,
                column,
                missing: false,
              });
            end = cell.end;
          }
          hide(end, row.to);
          for (let column = row.cells.length; column < table.align.length; column++)
            marks.push({
              kind: "table-empty",
              from: row.to,
              tableFrom: table.from,
              row: rowIndex,
              column,
              missing: true,
            });
        }
      }
      if (node.name === "Blockquote" || node.name === "FencedCode" || node.name === "CodeBlock") {
        const quote = node.name === "Blockquote",
          kind = quote ? "knowledge-live-quote" : "knowledge-live-code";
        for (
          let pos = Math.max(doc.lineAt(node.from).from, doc.lineAt(from).from);
          pos <= Math.min(node.to, to);
        ) {
          const line = doc.lineAt(pos);
          const start = !quote && line.from === doc.lineAt(node.from).from;
          const end = !quote && line.to >= node.to;
          lineMark(
            line.from,
            `${kind}${start ? ` ${kind}-start` : ""}${end ? ` ${kind}-end` : ""}${start && active(node.from, node.to) ? " knowledge-live-code-active" : ""}`,
          );
          if (line.to >= node.to || line.to >= doc.length) break;
          pos = line.to + 1;
        }
        if (quote) return; // Nested inline syntax remains editable inside quotes.
        if (node.name === "FencedCode") {
          const info = node.node.firstChild?.nextSibling;
          if (node.from >= from && node.from <= to) {
            marks.push({
              kind: "code-tools",
              from: doc.lineAt(node.from).to,
              language:
                info?.name === "CodeInfo"
                  ? doc.sliceString(info.from, info.to).split(/\s/u)[0]!
                  : "",
            });
          }
          return;
        }
        return false; // Code examples must never become links or formatting widgets.
      }
      if (node.name === "CodeText") return false;
      if (
        (node.name === "CodeMark" || node.name === "CodeInfo") &&
        node.node.parent?.name === "FencedCode"
      ) {
        const line = doc.lineAt(node.from);
        if (node.name === "CodeMark") lineMark(line.from, "knowledge-live-fence");
        if (!active(line.from, line.to)) hide(node.from, node.to);
        return false;
      }
      if (node.name === "ListItem") {
        const item = node.node,
          mark = item.firstChild;
        if (!mark || mark.name !== "ListMark") return;
        const next = mark.nextSibling,
          task = next?.name === "Task" ? next.firstChild : null;
        if (active(mark.from, task?.name === "TaskMarker" ? task.to : mark.to, false)) return;
        if (task?.name === "TaskMarker") {
          marks.push({
            kind: "task",
            from: mark.from,
            to: task.to,
            checked: /\[[xX]\]/u.test(doc.sliceString(task.from, task.to)),
            marker: task.from - mark.from + 1,
          });
        } else if (item.parent?.name === "OrderedList") {
          marks.push({ kind: "ordinal", from: mark.from, to: mark.to });
        } else {
          const line = doc.lineAt(mark.from);
          marks.push({
            kind: "bullet",
            from: mark.from,
            to: mark.to,
            depth: listDepth(line.text, mark.from - line.from),
          });
        }
        return;
      }
      if (node.name === "Link" || node.name === "Image") {
        const link = node.node;
        if (inWiki(link.from, link.to)) return false;
        const url = link.getChild("URL"),
          target = url ? doc.sliceString(url.from, url.to).replace(/^<|>$/gu, "") : "";
        // Attachment widgets own these ranges, including their source reveal policy.
        if (
          (target.startsWith("attachment:") ||
            (!url &&
              editorAttachments(doc).some(
                (ref) => ref.from === link.from && ref.to === link.to,
              ))) &&
          (node.name === "Image" ||
            (doc.lineAt(link.from).from === link.from && doc.lineAt(link.to).to === link.to))
        )
          return false;
        if (node.name === "Link") {
          const delimiters = link.getChildren("LinkMark");
          const open = delimiters[0],
            close = delimiters[1];
          const resolved = target || editorLinkAt(state, link.from)?.url;
          if (open && close && close.from > open.to && resolved)
            marks.push({ kind: "link-chip", from: open.to, to: close.from, target: resolved });
        }
        return;
      }
      if (node.name === "InlineCode") {
        if (!inWiki(node.from, node.to)) marks.push({ kind: "code", from: node.from, to: node.to });
        return;
      }
      const parent = node.node.parent;
      if (!parent || inWiki(node.from, node.to)) return;
      if (/^(?:HeaderMark|QuoteMark)$/u.test(node.name)) {
        const end = node.to + (doc.sliceString(node.to, node.to + 1) === " " ? 1 : 0);
        if (!active(node.from, end, false)) hide(node.from, end);
      } else if (
        /^(?:EmphasisMark|CodeMark|StrikethroughMark)$/u.test(node.name) ||
        (/^(?:LinkMark|LinkLabel|URL|LinkTitle)$/u.test(node.name) &&
          /^(?:Link|Image)$/u.test(parent.name))
      ) {
        if (!active(parent.from, parent.to)) hide(node.from, node.to);
      }
    },
  });
  for (const link of wiki) {
    if (!active(link.from, link.to))
      marks.push({
        kind: "chip",
        from: link.from,
        to: link.to,
        label: link.label,
        target: link.target,
      });
  }
  return marks;
}
