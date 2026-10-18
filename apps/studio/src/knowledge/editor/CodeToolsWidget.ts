import { EditorView, WidgetType } from "@codemirror/view";
import { codeBlockAt, codeLanguageChange, type CodeBlock } from "./codeBlocks";
import { codeLanguageChoices, codeLanguageValue } from "./codeLanguages";
import { runEditorEdit } from "./editorCommands";
import { liveComposition } from "./liveSelection";

/** Controls stay outside the editable code text; actions resolve the current block from DOM. */
export class CodeToolsWidget extends WidgetType {
  constructor(
    private language: string,
    private readOnly: boolean,
  ) {
    super();
  }
  eq(other: CodeToolsWidget) {
    return this.language === other.language && this.readOnly === other.readOnly;
  }
  toDOM() {
    const root = document.createElement("span");
    root.className = "knowledge-code-tools";
    root.setAttribute("role", "group");
    root.setAttribute("aria-label", "代码块操作");
    const select = document.createElement("select");
    select.setAttribute("aria-label", "代码块语言");
    select.disabled = this.readOnly;
    const value = codeLanguageValue(this.language);
    for (const choice of codeLanguageChoices) select.add(new Option(choice.label, choice.value));
    if (![...select.options].some((option) => option.value === value))
      select.add(new Option(this.language, value));
    select.value = value;
    const copy = document.createElement("button");
    copy.type = "button";
    copy.textContent = "复制代码";
    const status = document.createElement("span");
    status.className = "knowledge-code-status";
    status.setAttribute("role", "status");
    let captured: CodeBlock | null = null;
    const current = () => {
      const view = EditorView.findFromDOM(root);
      return view ? { view, block: codeBlockAt(view.state, view.posAtDOM(root)) } : null;
    };
    select.addEventListener("focus", () => {
      captured = current()?.block ?? null;
    });
    select.addEventListener("change", () => {
      const found = current();
      if (!found?.block) return;
      const { view, block } = found;
      if (
        view.state.readOnly ||
        view.compositionStarted ||
        view.state.field(liveComposition, false) ||
        (captured && captured.doc !== view.state.doc)
      ) {
        status.textContent = "代码已变化，请重新选择";
        select.value = codeLanguageValue(block.language);
        captured = null;
        return;
      }
      runEditorEdit(view, {
        changes: codeLanguageChange(block, select.value),
        userEvent: "input.format",
      });
      captured = null;
    });
    copy.addEventListener("click", async () => {
      const found = current();
      if (!found?.block) return;
      const doc = found.view.state.doc;
      try {
        await navigator.clipboard.writeText(found.block.text);
        if (root.isConnected && found.view.state.doc === doc) status.textContent = "已复制代码";
      } catch {
        if (root.isConnected && found.view.state.doc === doc)
          status.textContent = "复制失败，请选中代码后复制";
      }
    });
    root.append(select, copy, status);
    return root;
  }
  ignoreEvent() {
    return true;
  }
}
