import { memo, useLayoutEffect, useRef, useState, type ComponentType } from "react";
import { ArrowDown, Sparkles } from "lucide-react";
import type { AgentConversation, AgentRun, AgentConversations } from "@bcr/agent";
import { ToolExecutionCard } from "./ToolExecutionCard";
import type { ResultRegistry } from "./renderers";

const PlainText = ({ text }: { text: string }) => <p className="bcr-chat-text">{text}</p>;
const RunView = memo(function RunView({
  run,
  last,
  manager,
  conversationId,
  registry,
  Text,
  settings,
  busy,
}: {
  run: AgentRun;
  last: boolean;
  manager: AgentConversations;
  conversationId: string;
  registry?: ResultRegistry | undefined;
  Text: ComponentType<{ text: string }>;
  settings: () => void;
  busy: boolean;
}) {
  const [retryError, setRetryError] = useState<string | null>(null);
  const running = run.status === "running" || run.status === "awaiting_approval";
  const hasTools = run.parts.some((part) => part.type === "tool");
  return (
    <div className="bcr-chat-turn" data-run-id={run.id}>
      <article className="bcr-chat-line is-user" aria-label="你的消息">
        <p>{run.input}</p>
      </article>
      <article className="bcr-chat-line is-agent" aria-label="助手回复" aria-busy={running}>
        <div className="bcr-chat-turn-meta">
          <Sparkles size={13} aria-hidden="true" />
          <span>{run.workspace}</span>
          <span>
            {running
              ? run.status === "awaiting_approval"
                ? "需要你确认"
                : "正在处理"
              : "执行记录"}
          </span>
        </div>
        {run.parts.map((part) =>
          part.type === "text" ? (
            <Text key={part.id} text={part.text} />
          ) : (
            <ToolExecutionCard
              key={part.id}
              part={part}
              running={running}
              registry={registry}
              resolve={(approved) => {
                manager.resolveApproval(run.id, part.call.id, approved);
              }}
            />
          ),
        )}
        {running && run.parts.length === 0 && (
          <p className="bcr-chat-wait">
            正在连接模型<span aria-hidden="true">…</span>
          </p>
        )}
        {run.status === "failed" && (
          <div className="bcr-chat-error" role="alert">
            <strong>本次请求未完成</strong>
            <p>{run.error}</p>
            <p>
              {hasTools
                ? "已执行的操作不会自动撤销。请先核实上方记录，再发送新指令，避免重复操作。"
                : "请检查接口、模型和网络。同源代理可用于解决跨域访问问题。"}
            </p>
            {last && !hasTools && (
              <button
                className="bcr-chat-button"
                disabled={busy}
                onClick={() => {
                  setRetryError(null);
                  void Promise.resolve()
                    .then(() => manager.retry(conversationId, run.id))
                    .catch((error: unknown) => setRetryError(String(error)));
                }}
              >
                重试
              </button>
            )}
            {retryError && <p role="alert">{retryError}</p>}
            <button className="bcr-chat-button" onClick={settings}>
              检查接口
            </button>
          </div>
        )}
        {(run.status === "cancelled" || run.status === "interrupted") && (
          <p className="bcr-chat-hint">
            {run.status === "cancelled" ? "已停止生成。" : "上次任务已中断，未自动恢复执行。"}
            {hasTools && "请核实工具回执后再继续；没有回执的操作结果未知。"}
          </p>
        )}
        {run.status === "round_limit" && (
          <p className="bcr-chat-hint">
            已达到本次执行上限，任务可能尚未完成。请核实工具结果后发送新指令。
          </p>
        )}
      </article>
    </div>
  );
});

export function AgentTimeline({
  conversation,
  manager,
  renderText = PlainText,
  registry,
  settings,
  busy,
}: {
  conversation: AgentConversation;
  manager: AgentConversations;
  renderText?: ComponentType<{ text: string }> | undefined;
  registry?: ResultRegistry | undefined;
  settings: () => void;
  busy: boolean;
}) {
  const viewport = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const following = useRef(true);
  const [unread, setUnread] = useState(false);
  useLayoutEffect(() => {
    const view = viewport.current;
    if (!view || !content.current) return;
    const follow = () => {
      if (following.current) view.scrollTop = view.scrollHeight;
      else setUnread(true);
    };
    follow();
    const observer = new ResizeObserver(follow);
    observer.observe(content.current);
    return () => observer.disconnect();
  }, []);
  return (
    <div className="bcr-chat-thread">
      <div
        className="bcr-chat-viewport"
        ref={viewport}
        role="region"
        aria-label="对话记录"
        tabIndex={0}
        onScroll={() => {
          const view = viewport.current!;
          following.current = view.scrollHeight - view.scrollTop - view.clientHeight < 48;
          if (following.current) setUnread(false);
        }}
      >
        <div ref={content} className="bcr-chat-timeline">
          {conversation.runs.length === 0 ? (
            <div className="bcr-chat-empty">
              <Sparkles size={25} strokeWidth={1.3} aria-hidden="true" />
              <small>随时开始 · 跨领域协作</small>
              <h2>把下一步，交给助手。</h2>
              <p>
                从一个问题开始，或一起处理当前内容。
                <br />
                涉及修改的操作，会先征求你的确认。
              </p>
            </div>
          ) : (
            conversation.runs.map((run, index) => (
              <RunView
                key={run.id}
                run={run}
                last={index === conversation.runs.length - 1}
                manager={manager}
                conversationId={conversation.id}
                Text={renderText}
                registry={registry}
                settings={settings}
                busy={busy}
              />
            ))
          )}
        </div>
      </div>
      {unread && (
        <button
          type="button"
          className="bcr-chat-jump bcr-chat-button"
          onClick={() => {
            following.current = true;
            setUnread(false);
            if (viewport.current) viewport.current.scrollTop = viewport.current.scrollHeight;
          }}
        >
          <ArrowDown size={14} aria-hidden="true" />
          回到最新消息
        </button>
      )}
    </div>
  );
}
