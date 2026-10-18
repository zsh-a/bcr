import { syntaxTree } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";
import { editorAnalysis, editorAttachments } from "./editorAnalysis";
import { touchesSyntax } from "./liveSelection";

export type LiveMark =
  | { kind: "hide"; from: number; to: number }
  | { kind: "bullet"; from: number; to: number; depth: number }
  | { kind: "ordinal"; from: number; to: number }
  | { kind: "task"; from: number; to: number; checked: boolean; marker: number }
  | { kind: "chip"; from: number; to: number; label: string; target: string }
  | { kind: "link-chip"; from: number; to: number; target: string }
  | { kind: "code"; from: number; to: number }
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
    enter(node) {
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
            `${kind}${start ? ` ${kind}-start` : ""}${end ? ` ${kind}-end` : ""}`,
          );
          if (line.to >= node.to || line.to >= doc.length) break;
          pos = line.to + 1;
        }
        if (quote) return; // Nested inline syntax remains editable inside quotes.
        if (node.name === "FencedCode") {
          for (let child = node.node.firstChild; child; child = child.nextSibling) {
            if (child.name !== "CodeMark") continue;
            const line = doc.lineAt(child.from);
            if (line.from < from || line.from > to) continue;
            lineMark(line.from, "knowledge-live-fence");
            if (active(line.from, line.to)) continue;
            // Preserve line breaks: indirect decorations cannot replace block layout.
            hide(child.from, child.to);
          }
        }
        return false; // Code examples must never become links or formatting widgets.
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
          const resolved =
            target || editorAnalysis(state).links.find((entry) => entry.from === link.from)?.target;
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
