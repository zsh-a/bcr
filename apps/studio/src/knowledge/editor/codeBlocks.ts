import { syntaxTree } from "@codemirror/language";
import type { EditorState, Text } from "@codemirror/state";
import { IterMode, type SyntaxNode } from "@lezer/common";
import { unified } from "unified";
import remarkParse from "remark-parse";
import type { Root, RootContent } from "mdast";

const parser = unified().use(remarkParse);
const values = new WeakMap<Text, { from: number; to: number; value: string }[]>();
function codeText(doc: Text, from: number, to: number) {
  let blocks = values.get(doc);
  if (!blocks) {
    blocks = [];
    const visit = (node: Root | RootContent) => {
      if (node.type === "code" && node.position)
        blocks!.push({
          from: node.position.start.offset!,
          to: node.position.end.offset!,
          value: node.value,
        });
      else if ("children" in node) for (const child of node.children) visit(child);
    };
    visit(parser.parse(doc.toString()));
    values.set(doc, blocks);
  }
  const block = blocks.find(
    (entry) =>
      entry.from <= from &&
      entry.to >= to &&
      doc.lineAt(entry.from).number === doc.lineAt(from).number,
  );
  if (!block) throw new Error("无法读取代码正文，请从源码复制");
  return block.value;
}

export interface CodeBlock {
  doc: Text;
  from: number;
  to: number;
  tokenFrom: number;
  tokenTo: number;
  language: string;
  suffix: string;
  text: string;
}
export function codeBlock(state: EditorState, node: SyntaxNode): CodeBlock | null {
  if (node.name !== "FencedCode") return null;
  const cursor = node.cursor(IterMode.IgnoreMounts);
  let opener: SyntaxNode | null = null,
    info: SyntaxNode | null = null;
  if (cursor.firstChild())
    do {
      if (cursor.name === "CodeMark" && !opener) opener = cursor.node;
      if (cursor.name === "CodeInfo") info = cursor.node;
      if (cursor.name === "CodeText") break;
    } while (cursor.nextSibling());
  if (!opener) return null;
  const raw = info ? state.sliceDoc(info.from, info.to) : "";
  const token = /^\S*/u.exec(raw)![0];
  return {
    doc: state.doc,
    from: node.from,
    to: node.to,
    tokenFrom: info?.from ?? opener.to,
    tokenTo: (info?.from ?? opener.to) + token.length,
    language: token,
    suffix: raw.slice(token.length),
    get text() {
      const text = codeText(state.doc, node.from, node.to);
      const last = node.lastChild;
      const closed = last?.name === "CodeMark" && last.from !== opener!.from;
      return !closed &&
        node.to > state.doc.lineAt(opener!.from).to + 1 &&
        state.sliceDoc(node.to - 1, node.to) === "\n"
        ? text + "\n"
        : text;
    },
  };
}
export function codeBlockAt(state: EditorState, pos: number) {
  const cursor = syntaxTree(state).cursor(IterMode.IgnoreMounts).moveTo(pos, -1);
  do {
    if (cursor.name === "FencedCode") return codeBlock(state, cursor.node);
  } while (cursor.parent());
  return null;
}
export function codeLanguageChange(block: CodeBlock, language: string) {
  if (language && !/^[a-zA-Z0-9_+.#-]{1,64}$/u.test(language)) throw new Error("代码语言标记无效");
  // Keep attributes meaningful when changing an annotated fence to plain text.
  return {
    from: block.tokenFrom,
    to: block.tokenTo,
    insert: language || (block.suffix.trim() ? "text" : ""),
  };
}
