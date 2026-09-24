import { useEffect, useRef, type ReactNode } from "react";
import { ArrowUp, Square } from "lucide-react";

export function AgentComposer({
  draft,
  setDraft,
  send,
  cancel,
  running,
  disabled,
  footer,
}: {
  draft: string;
  setDraft: (text: string) => void;
  send: () => void;
  cancel: () => void;
  running: boolean;
  disabled: boolean;
  footer?: ReactNode;
}) {
  const input = useRef<HTMLTextAreaElement>(null);
  const composing = useRef(false);
  useEffect(() => {
    if (!input.current) return;
    input.current.style.height = "auto";
    input.current.style.height = `${Math.min(input.current.scrollHeight, 180)}px`;
  }, [draft]);
  return (
    <form
      className="bcr-chat-composer"
      onSubmit={(event) => {
        event.preventDefault();
        if (!disabled && !running && draft.trim()) send();
      }}
    >
      <textarea
        ref={input}
        aria-label="发送给 AI 助手的消息"
        className="bcr-chat-input"
        placeholder="提问、整理思路，或请我处理当前内容…"
        rows={2}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onCompositionStart={() => {
          composing.current = true;
        }}
        onCompositionEnd={() => {
          composing.current = false;
        }}
        onKeyDown={(event) => {
          if (
            event.key === "Enter" &&
            !event.shiftKey &&
            !event.nativeEvent.isComposing &&
            !composing.current &&
            event.keyCode !== 229
          ) {
            event.preventDefault();
            if (!disabled && !running && draft.trim()) send();
          }
        }}
      />
      <div className="bcr-chat-composer-actions">
        <div className="bcr-chat-composer-meta">{footer}</div>
        {running ? (
          <button type="button" className="ui-btn ui-btn-default ui-btn-lg" onClick={cancel}>
            <Square size={13} aria-hidden="true" />
            停止
          </button>
        ) : (
          <button
            type="submit"
            className="ui-btn ui-btn-primary ui-btn-lg"
            disabled={disabled || !draft.trim()}
          >
            <ArrowUp size={16} aria-hidden="true" />
            发送
          </button>
        )}
      </div>
    </form>
  );
}
