import { autocompletion, type CompletionContext } from "@codemirror/autocomplete";
import { syntaxTree } from "@codemirror/language";
import { EditorView } from "@codemirror/view";
import type { KnowledgeNote } from "./model";
import { noteWikiLink } from "./markdownAnalysis";
import { localDay } from "./workbench";

function inCode(context: CompletionContext, wiki?: { from: number; to: number }) {
  for (
    let node = syntaxTree(context.state).resolveInner(context.pos, -1);
    node;
    node = node.parent!
  ) {
    if (
      /Code|HTML|Image/u.test(node.name) ||
      (/Link/u.test(node.name) && (!wiki || node.from < wiki.from || node.to > wiki.to))
    )
      return true;
  }
  return false;
}

export function noteEditing(notes: () => readonly KnowledgeNote[], open: (target: string) => void) {
  return [
    autocompletion({
      override: [
        (context) => {
          if (inCode(context)) return null;
          const wiki = context.matchBefore(/\[\[[^\]\n[]*/u);
          if (wiki)
            return {
              from: wiki.from,
              filter: false,
              options: notes()
                .filter((note) =>
                  note.title.toLocaleLowerCase().includes(wiki.text.slice(2).toLocaleLowerCase()),
                )
                .slice(0, 40)
                .map((note) => ({
                  label: note.title || "未命名笔记",
                  detail: note.id.slice(0, 8),
                  type: "text",
                  apply: noteWikiLink(note),
                })),
            };
          const slash = context.matchBefore(/^\/[^\s]*/u);
          if (!slash) return null;
          const commands = [
            { label: "/标题", apply: "## " },
            { label: "/任务", apply: "- [ ] " },
            { label: "/引用", apply: "> " },
            { label: "/日期", apply: localDay() },
            { label: "/代码", apply: "```\n\n```" },
            { label: "/表格", apply: "| 项目 | 内容 |\n| --- | --- |\n|  |  |" },
          ];
          return { from: slash.from, options: commands };
        },
      ],
    }),
    EditorView.domEventHandlers({
      click(event, view) {
        if (!event.ctrlKey && !event.metaKey) return false;
        const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
        if (pos === null) return false;
        const line = view.state.doc.lineAt(pos);
        for (const match of line.text.matchAll(/\[\[([^\]\n|[]+)(?:\|[^\]\n]*)?\]\]/gu)) {
          if (pos < line.from + match.index || pos > line.from + match.index + match[0].length)
            continue;
          const context = { state: view.state, pos } as CompletionContext;
          if (
            inCode(context, {
              from: line.from + match.index,
              to: line.from + match.index + match[0].length,
            }) ||
            line.text[match.index - 1] === "\\" ||
            line.text[match.index - 1] === "!"
          )
            return false;
          event.preventDefault();
          open(match[1]!);
          return true;
        }
        return false;
      },
    }),
  ];
}
