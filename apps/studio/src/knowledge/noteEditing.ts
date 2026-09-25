import {
  acceptCompletion,
  autocompletion,
  insertCompletionText,
  pickedCompletion,
  selectedCompletion,
  type Completion,
  type CompletionContext,
  type CompletionSection,
} from "@codemirror/autocomplete";
import { syntaxTree } from "@codemirror/language";
import { Prec } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { notePath } from "./paths";
import type { KnowledgeNote } from "./model";
import { analyzeMarkdown, noteWikiLink } from "./markdownAnalysis";
import { fillTemplate, localDay } from "./workbench";
import { editorAnalysis } from "./editorAnalysis";

/** 当前笔记身份与标题；模板的 {{title}} 变量取实时标题。 */
export interface SlashContext {
  id: string;
  title: string;
}

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

/** 应用插入：连同触发的 “/” 一起替换，光标停在插入内容之后。 */
function inserting(text: string) {
  return (view: EditorView, completion: Completion, from: number, to: number) => {
    view.dispatch({
      changes: { from: from - 1, to, insert: text },
      annotations: pickedCompletion.of(completion),
    });
    view.focus();
  };
}

const blocksSection: CompletionSection = { name: "基础块" };
const templatesSection: CompletionSection = { name: "模板" };

/** / 插入面板的基础块：图标（type）+ 单行预览（detail）。 */
const insertBlocks: Completion[] = [
  { label: "标题 1", detail: "# 标题", type: "heading1", apply: inserting("# ") },
  { label: "标题 2", detail: "## 标题", type: "heading2", apply: inserting("## ") },
  { label: "标题 3", detail: "### 标题", type: "heading3", apply: inserting("### ") },
  { label: "无序列表", detail: "- 项目", type: "list", apply: inserting("- ") },
  { label: "任务列表", detail: "- [ ] 任务", type: "task", apply: inserting("- [ ] ") },
  { label: "引用", detail: "> 引文", type: "quote", apply: inserting("> ") },
  { label: "代码块", detail: "```语言", type: "code", apply: inserting("```\n\n```") },
  { label: "分割线", detail: "---", type: "divider", apply: inserting("---\n") },
  {
    label: "表格",
    detail: "| 项目 | 内容 |",
    type: "table",
    apply: inserting("| 项目 | 内容 |\n| --- | --- |\n|  |  |"),
  },
  { label: "日期", detail: localDay(), type: "date", apply: inserting(localDay()) },
].map((item) => ({ ...item, boost: 2, section: blocksSection }));

/** 模板条目跟随知识库现状；插入前用当前标题展开 {{title}}。 */
function templateBlocks(notes: () => readonly KnowledgeNote[], currentNote: () => SlashContext) {
  return notes()
    .filter(
      (item) =>
        item.id !== currentNote().id &&
        item.tags.some((tag) => tag === "模板" || tag === "template"),
    )
    .map((item) => ({
      label: `模板 ${item.title || "未命名模板"}`,
      detail: fillTemplate(item.body, currentNote().title).split("\n")[0]!.slice(0, 40),
      type: "template",
      boost: 1,
      section: templatesSection,
      apply: inserting(fillTemplate(item.body, currentNote().title)),
    }));
}

export function noteEditing(
  notes: () => readonly KnowledgeNote[],
  open: (target: string) => void,
  currentNote: () => SlashContext = () => ({ id: "", title: "" }),
) {
  /** 最近一次补全查询的替换区间；pending 落定窗口里库不给应用时按它落地。 */
  let recent: { from: number; to: number } | null = null;
  /** 列表上实际渲染的所选项；库的 accessor 在落定窗口里会隐藏列表状态。 */
  let selected: Completion | null = null;

  /**
   * Enter 在补全列表可见时立即接受所选项：列表刚打开或刚被 Ctrl+Space 重启都一样
   * （库内 acceptCompletion 会按 interactionDelay/落定窗口拒绝，把 Enter 漏成换行）。
   * IME 组合确认的 Enter 一概不动正文（真实组合事件由编辑器丢弃，这里兜底合成事件）。
   */
  function acceptVisibleCompletion(view: EditorView, composing: boolean) {
    if (composing || view.state.readOnly || view.compositionStarted) return false;
    // 列表没开，或列表已落后于正文（输入后的查询还没落地）：保持 Enter 原行为。
    if (!view.dom.querySelector(".cm-tooltip-autocomplete")) return false;
    const range = recent;
    if (!range || range.to !== view.state.selection.main.head) return false;
    const completion = selectedCompletion(view.state) ?? selected;
    if (!completion) return false;
    if (acceptCompletion(view)) return true;
    // 落定窗口（手动重启后查询 pending）：按查询区间直接应用，语义与库内一致。
    const apply = completion.apply ?? completion.label;
    if (typeof apply === "string")
      view.dispatch({
        ...insertCompletionText(view.state, apply, range.from, range.to),
        annotations: pickedCompletion.of(completion),
      });
    else apply(view, completion, range.from, range.to);
    return true;
  }

  return [
    autocompletion({
      override: [
        (context: CompletionContext) => {
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
            recent = { from: wiki.from, to: context.pos };
            return {
              from: wiki.from,
              filter: false,
              options: notes()
                .filter((note) =>
                  [note.title, notePath(note)].some((value) =>
                    value.toLocaleLowerCase().includes(wiki.text.slice(2).toLocaleLowerCase()),
                  ),
                )
                .slice(0, 40)
                .map((note) => ({
                  label: note.title || "未命名笔记",
                  detail: notePath(note),
                  type: "text",
                  apply: noteWikiLink(note),
                })),
            };
          }
          if (inCode(context)) return null;
          // 查询可含空格（“标题 2”）；“/” 前必须是行首或空白，避免 2024/05 之类误触发。
          const slash = context.matchBefore(/(?:^|\s)\/[^\n]*/u);
          if (!slash) return null;
          // 光标停在 “/” 之后：查询只过滤，插入时连 “/” 一并替换。
          const from = slash.from + slash.text.indexOf("/") + 1;
          recent = { from, to: context.pos };
          return {
            from,
            options: [...insertBlocks, ...templateBlocks(notes, currentNote)],
          };
        },
      ],
    }),
    EditorView.updateListener.of((update) => {
      const completion = selectedCompletion(update.state);
      if (completion) selected = completion;
    }),
    // 必须先于 markdownKeymap 的 Enter（换行）：列表可见即接受。
    Prec.high(
      EditorView.domEventHandlers({
        keydown(event, view) {
          if (
            event.key !== "Enter" ||
            event.ctrlKey ||
            event.metaKey ||
            event.altKey ||
            event.shiftKey
          )
            return false;
          return acceptVisibleCompletion(view, event.isComposing || event.keyCode === 229);
        },
      }),
    ),
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
