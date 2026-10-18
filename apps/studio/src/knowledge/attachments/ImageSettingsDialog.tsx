import { useRef, useState, type RefObject } from "react";
import { Button, Dialog } from "@bcr/react";
import type { MarkdownEditorHandle } from "../editor/MarkdownEditor";
import type { AttachmentReference } from "./attachmentModel";
import { imageReferenceMarkdown } from "./imageReference";

export interface ImageSettingsTarget {
  ref: AttachmentReference;
  document: string;
  expected: string;
}
export function ImageSettingsDialog({
  target,
  source,
  disabled,
  onClose,
}: {
  target: ImageSettingsTarget;
  source: RefObject<MarkdownEditorHandle | null>;
  disabled: boolean;
  onClose: () => void;
}) {
  const [label, setLabel] = useState(target.ref.label);
  const [width, setWidth] = useState(target.ref.width?.toString() ?? "");
  const [error, setError] = useState("");
  const composing = useRef(false);
  return (
    <Dialog open onClose={onClose} title="图片设置" className="knowledge-image-settings">
      <form
        className="knowledge-image-settings-form"
        onCompositionStart={() => {
          composing.current = true;
        }}
        onCompositionEnd={() => {
          composing.current = false;
        }}
        onKeyDown={(event) => {
          if (
            event.key === "Enter" &&
            (composing.current || event.nativeEvent.isComposing || event.keyCode === 229)
          )
            event.preventDefault();
        }}
        onSubmit={(event) => {
          event.preventDefault();
          if (disabled || composing.current) return;
          try {
            const text = imageReferenceMarkdown(
              target.document,
              target.ref,
              label,
              width ? Number(width) : undefined,
            );
            if (
              !source.current?.replaceRange(
                target.ref.from,
                target.ref.to,
                text,
                target.expected,
                target.document,
              )
            )
              throw new Error("正文已变化，请取消后重新打开设置；本次输入已保留");
            onClose();
          } catch (reason) {
            setError(reason instanceof Error ? reason.message : String(reason));
          }
        }}
      >
        <label>
          图片说明
          <input
            className="ui-input"
            aria-label="图片说明"
            autoFocus
            maxLength={1000}
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
        </label>
        <label>
          显示宽度
          <input
            className="ui-input"
            aria-label="显示宽度"
            type="number"
            min={32}
            max={4096}
            step={1}
            placeholder="自动"
            value={width}
            onChange={(e) => setWidth(e.target.value)}
          />
        </label>
        <p className="ui-help">留空使用原尺寸；图片会自动适应正文宽度。</p>
        {error && (
          <p role="alert" className="ui-error">
            {error}
          </p>
        )}
        <div className="ui-actions">
          <Button type="button" variant="ghost" onClick={onClose}>
            取消
          </Button>
          <Button type="submit" disabled={disabled}>
            保存图片设置
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
