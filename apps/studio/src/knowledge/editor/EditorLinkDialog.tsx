import { useRef, useState } from "react";
import { Button, Dialog, Input } from "@bcr/react";
import {
  editorLinkMarkdown,
  safeEditorLink,
  targetValid,
  type EditorTarget,
} from "./editorContext";
import { runEditorEdit } from "./editorCommands";

/** Both the context menu and inline tools share the same source-preserving edit path. */
export function EditorLinkDialog({
  target,
  onClose,
}: {
  target: EditorTarget;
  onClose: () => void;
}) {
  const [label, setLabel] = useState(
    target.link?.label ?? target.doc.sliceString(target.from, target.to),
  );
  const [url, setUrl] = useState(target.link?.url ?? "");
  const [error, setError] = useState("");
  const composing = useRef(false);
  return (
    <Dialog
      open
      title={target.link ? "编辑链接" : "插入链接"}
      onClose={onClose}
      className="knowledge-link-dialog"
    >
      <form
        className="knowledge-link-form"
        onCompositionStart={() => {
          composing.current = true;
        }}
        onCompositionEnd={() => {
          composing.current = false;
        }}
        onKeyDown={(event) => {
          if (
            event.key === "Enter" &&
            (composing.current ||
              event.nativeEvent.isComposing ||
              event.nativeEvent.keyCode === 229)
          )
            event.preventDefault();
        }}
        onSubmit={(event) => {
          event.preventDefault();
          if (composing.current) return;
          if (!targetValid(target)) return setError("正文或选区已变化，请重新选择后操作。");
          if (!safeEditorLink(url))
            return setError("请输入有效的网址、笔记名称或路径。网址支持 http、https 和 mailto。");
          try {
            const markdown = editorLinkMarkdown(target, label.trim(), url.trim());
            const from = target.link?.from ?? target.from,
              to = target.link?.to ?? target.to;
            runEditorEdit(target.view, {
              changes: { from, to, insert: markdown },
              selection: { anchor: from + markdown.length },
              userEvent: "input",
              scrollIntoView: true,
            });
            onClose();
          } catch (reason) {
            setError(reason instanceof Error ? reason.message : String(reason));
          }
        }}
      >
        <label>
          显示文字
          <Input
            aria-label="链接显示文字"
            autoFocus
            value={label}
            onChange={(event) => {
              setLabel(event.target.value);
              setError("");
            }}
          />
        </label>
        <label>
          链接目标
          <Input
            aria-label="链接目标"
            required
            placeholder="https://… 或笔记名称、路径"
            value={url}
            onChange={(event) => {
              setUrl(event.target.value);
              setError("");
            }}
          />
        </label>
        <p className="knowledge-hint">笔记名称和路径会作为知识库内部链接打开。</p>
        {error && (
          <p role="alert" className="knowledge-alert">
            {error}
          </p>
        )}
        <div className="knowledge-dialog-actions">
          <Button type="button" onClick={onClose}>
            取消
          </Button>
          <Button type="submit" variant="primary" disabled={target.view.state.readOnly}>
            {target.link ? "保存链接" : "插入链接"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
