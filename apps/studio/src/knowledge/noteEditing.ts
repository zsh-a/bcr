import { autocompletion, type CompletionContext } from "@codemirror/autocomplete";
import { syntaxTree } from "@codemirror/language";
import { EditorView } from "@codemirror/view";
import type { KnowledgeNote } from "./model";
import { analyzeMarkdown, noteWikiLink } from "./markdownAnalysis";
import { localDay } from "./workbench";
import { editorAnalysis } from "./editorAnalysis";

function inCode(context: CompletionContext) {
  for (
    let node = syntaxTree(context.state).resolveInner(context.pos, -1);
    node;
    node = node.parent!
  ) {
    if (/Code|HTML|Image|Link/u.test(node.name)) return true;
  }
  return false;
}

export function noteEditing(notes: () => readonly KnowledgeNote[], open: (target: string) => void) {
  return [
    autocompletion({
      override: [
        (context) => {
          const wiki = context.matchBefore(/\[\[[^\]\n[]*/u);
          if (wiki) {
            const candidate =
              context.state.sliceDoc(0, context.pos) +
              "__completion__]]" +
              context.state.sliceDoc(context.pos);
            if (
              !analyzeMarkdown(candidate).links.some(
                (link) => link.kind === "wiki" && link.from === wiki.from,
              )
            )
              return null;
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
          }
          if (inCode(context)) return null;
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
        const link = editorAnalysis(view.state).links.find(
          (link) => pos >= link.from && pos < link.to,
        );
        if (link) {
          event.preventDefault();
          open(link.target);
          return true;
        }
        return false;
      },
    }),
  ];
}
