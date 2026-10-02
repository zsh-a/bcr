import { EditorSelection, type EditorState, type TransactionSpec } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import { keymap, type EditorView } from "@codemirror/view";
import { localDay } from "./format";
import { isolateHistory } from "@codemirror/commands";

/** One registry for slash completion and the editor's insertion menu. */
export const editorBlocks = [
  { id: "h1", label: "标题 1", detail: "# 标题", type: "heading1", text: () => "# " },
  { id: "h2", label: "标题 2", detail: "## 标题", type: "heading2", text: () => "## " },
  { id: "h3", label: "标题 3", detail: "### 标题", type: "heading3", text: () => "### " },
  { id: "list", label: "无序列表", detail: "- 项目", type: "list", text: () => "- " },
  { id: "task", label: "任务列表", detail: "- [ ] 任务", type: "task", text: () => "- [ ] " },
  { id: "quote", label: "引用", detail: "> 引文", type: "quote", text: () => "> " },
  { id: "code", label: "代码块", detail: "```语言", type: "code", text: () => "```\n\n```" },
  { id: "divider", label: "分割线", detail: "---", type: "divider", text: () => "---\n" },
  {
    id: "table",
    label: "表格",
    detail: "| 项目 | 内容 |",
    type: "table",
    text: () => "| 项目 | 内容 |\n| --- | --- |\n|  |  |",
  },
  { id: "date", label: "日期", detail: "今天的日期", type: "date", text: localDay },
] as const;

export const editorFormats = [
  { id: "bold", label: "加粗", marker: "**", key: "Mod-b", hint: "B" },
  { id: "italic", label: "斜体", marker: "*", key: "Mod-i", hint: "I" },
  { id: "strike", label: "删除线", marker: "~~", key: "Mod-Shift-x", hint: "⇧X" },
  { id: "inline-code", label: "行内代码", marker: "`", key: "Mod-`", hint: "`" },
] as const;

export function proseContext(state: EditorState, pos = state.selection.main.head) {
  for (let node = syntaxTree(state).resolveInner(pos, -1); node; node = node.parent!)
    if (/Code|HTML|Image|Link/u.test(node.name)) return false;
  return true;
}

export function inlineCodeContext(state: EditorState, pos = state.selection.main.head) {
  for (let node = syntaxTree(state).resolveInner(pos, -1); node; node = node.parent!)
    if (node.name === "InlineCode") return node;
  return null;
}

function inlineCodeFormat(state: EditorState): TransactionSpec {
  const { from, to } = state.selection.main;
  if (from === to && from > 0 && state.sliceDoc(from - 1, to + 1) === "``")
    return {
      changes: { from: from - 1, to: to + 1 },
      selection: { anchor: from - 1 },
      userEvent: "input.format",
    };
  const code = inlineCodeContext(state);
  if (code && from >= code.from && to <= code.to) {
    const size = state.sliceDoc(code.from, code.to).match(/^`+/u)![0].length;
    const changes = state.changes([
      { from: code.from, to: code.from + size },
      { from: code.to - size, to: code.to },
    ]);
    return {
      changes,
      selection: state.selection.map(changes),
      userEvent: "input.format",
      scrollIntoView: true,
    };
  }
  const text = state.sliceDoc(from, to);
  const runs = [...text.matchAll(/`+/gu)].map((match) => match[0].length);
  const marker = "`".repeat(Math.max(0, ...runs) + 1);
  const pad = /^`|`$/u.test(text) || (/^ .* $/u.test(text) && /\S/u.test(text)) ? " " : "";
  return {
    changes: { from, to, insert: marker + pad + text + pad + marker },
    selection: EditorSelection.range(
      from + marker.length + pad.length,
      to + marker.length + pad.length,
    ),
    userEvent: "input.format",
    scrollIntoView: true,
  };
}

/** Toggle both selected delimiters and delimiters surrounding the selection. */
export function inlineFormat(state: EditorState, marker: string): TransactionSpec {
  if (marker === "`") return inlineCodeFormat(state);
  const { from, to } = state.selection.main;
  const text = state.sliceDoc(from, to),
    size = marker.length;
  let start = from,
    end = to,
    insert: string,
    anchor: number,
    head: number;
  const italicBoundary = (before: string, after: string) =>
    marker !== "*" ||
    (!before.endsWith("**") && !after.startsWith("**")) ||
    (before.endsWith("***") && after.startsWith("***"));
  if (
    text.length >= size * 2 &&
    text.startsWith(marker) &&
    text.endsWith(marker) &&
    italicBoundary(text.slice(-3), text.slice(0, 3))
  ) {
    insert = text.slice(size, -size);
    anchor = from;
    head = from + insert.length;
  } else if (
    from >= size &&
    state.sliceDoc(from - size, from) === marker &&
    state.sliceDoc(to, to + size) === marker &&
    italicBoundary(
      state.sliceDoc(Math.max(0, from - 3), from),
      state.sliceDoc(to, Math.min(state.doc.length, to + 3)),
    )
  ) {
    start -= size;
    end += size;
    insert = text;
    anchor = start;
    head = start + text.length;
  } else {
    insert = marker + text + marker;
    anchor = from + size;
    head = to + size;
  }
  return {
    changes: { from: start, to: end, insert },
    selection: EditorSelection.range(anchor, head),
    userEvent: "input.format",
    scrollIntoView: true,
  };
}

/** Apply or remove a block prefix across whole lines without dropping their contents. */
export function lineFormat(state: EditorState, prefix: string): TransactionSpec {
  const { from, to } = state.selection.main;
  const first = state.doc.lineAt(from),
    last = state.doc.lineAt(to > from ? to - 1 : to);
  const lines = Array.from({ length: last.number - first.number + 1 }, (_, i) =>
    state.doc.line(first.number + i),
  );
  const parts = lines.map((line) => {
    const indent = line.text.match(/^\s*/u)![0];
    return { line, indent, content: line.text.slice(indent.length) };
  });
  const remove = parts.every(({ content }) => content.startsWith(prefix));
  const changes = state.changes(
    parts.map(({ line, indent, content }) => ({
      from: line.from + indent.length,
      to: line.to,
      insert: remove
        ? content.slice(prefix.length)
        : prefix + content.replace(/^(?:#{1,6} |[-+*] (?:\[[ xX]\] )?|\d+[.)] |> )/u, ""),
    })),
  );
  return {
    changes,
    selection: state.selection.map(changes),
    userEvent: "input.format",
    scrollIntoView: true,
  };
}

export function insertBlock(state: EditorState, id: string): TransactionSpec {
  const block = editorBlocks.find((item) => item.id === id);
  if (!block) return {};
  const { from, to } = state.selection.main;
  const text = block.text();
  const before =
    id !== "date" && state.sliceDoc(state.doc.lineAt(from).from, from).trim() ? "\n" : "";
  const after = id !== "date" && state.sliceDoc(to, state.doc.lineAt(to).to).trim() ? "\n" : "";
  const head = from + before.length + (id === "code" ? 4 : text.length);
  return {
    changes: { from, to, insert: before + text + after },
    selection: { anchor: head },
    userEvent: "input",
    scrollIntoView: true,
  };
}

export function runEditorEdit(view: EditorView, spec: TransactionSpec) {
  if (view.state.readOnly) return false;
  view.dispatch(spec, { annotations: isolateHistory.of("full") });
  view.focus();
  return true;
}

export const editorFormattingKeys = keymap.of(
  editorFormats.map((format) => ({
    key: format.key,
    preventDefault: true,
    run: (view: EditorView) =>
      !view.state.readOnly &&
      (proseContext(view.state) ||
        (format.id === "inline-code" && !!inlineCodeContext(view.state))) &&
      !(
        format.id === "inline-code" &&
        view.state
          .sliceDoc(view.state.selection.main.from, view.state.selection.main.to)
          .includes("\n")
      ) &&
      runEditorEdit(view, inlineFormat(view.state, format.marker)),
  })),
);
