import { useState, type FunctionComponent } from "react";
import {
  AssistantRuntimeProvider,
  ActionBarPrimitive,
  ErrorPrimitive,
  ComposerPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  type ToolCallMessagePartProps,
} from "@assistant-ui/react";
import { useAgentHost } from "./AgentProvider";
import { useSyncExternalStore } from "react";
import { useAgentChat, type PendingApproval } from "./chat";
import { useAgent } from "./agent";
import "./chat.css";

/**
 * The agent chat panel.
 *
 * Composed from assistant-ui's unstyled primitives, so the panel inherits BCR's
 * design tokens instead of shipping a second visual language. The host mounts it
 * wherever a workspace wants it — a dock panel, a floating group, or an OS window
 * (dockview provides all three).
 */
export function AgentChatPanel({
  workspaceId = "home",
  workspaceLabel = "工作台",
  renderText,
}: {
  workspaceId?: string;
  workspaceLabel?: string;
  renderText?: FunctionComponent<{ text: string }>;
}) {
  const {
    subscribeSurfaces,
    surfaceSummary,
    subscribeAgentCapabilities,
    agentCapabilities,
    availableAgentCapabilities,
  } = useAgentHost();
  const [includeContext, setIncludeContext] = useState(true);
  const [disabledCapabilities, setDisabledCapabilities] = useState<readonly string[]>([]);
  const { runtime, approval, activity } = useAgentChat({
    workspaceId,
    workspaceLabel,
    includeContext,
    disabledCapabilities,
  });
  const agent = useAgent();
  const activeTarget = useSyncExternalStore(subscribeSurfaces, surfaceSummary, () => null);
  useSyncExternalStore(subscribeAgentCapabilities, agentCapabilities, agentCapabilities);
  const capabilities = availableAgentCapabilities(workspaceId);
  const enabled = capabilities.filter((item) => !disabledCapabilities.includes(item.id));
  const surface = activeTarget;
  const [settingsOpen, setSettingsOpen] = useState(false);

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <div className="bcr-chat">
        <header className="bcr-chat-head">
          <div className="bcr-chat-target">
            <span className="bcr-chat-eyebrow">当前工作区</span>
            <strong>{workspaceLabel}</strong>
          </div>
          <div className="bcr-chat-modes" role="group" aria-label="助手设置">
            <button
              type="button"
              aria-pressed={settingsOpen}
              onClick={() => setSettingsOpen(!settingsOpen)}
            >
              接口
            </button>
          </div>
        </header>

        {(surface !== null || capabilities.length > 0) && (
          <div className="bcr-chat-context" aria-label="可用能力">
            {surface !== null && (
              <button
                type="button"
                className={`bcr-chat-context-pill${includeContext ? " is-current" : ""}`}
                aria-pressed={includeContext}
                onClick={() => setIncludeContext((value) => !value)}
                title="附加当前选区并启用编辑工具"
              >
                当前内容
              </button>
            )}
            <details className="bcr-chat-capabilities">
              <summary>
                领域能力 <span>{enabled.length}</span>
              </summary>
              <div className="bcr-chat-capability-list">
                {capabilities.map((item) => (
                  <label key={item.id}>
                    <input
                      type="checkbox"
                      aria-label={`启用${item.label}`}
                      checked={!disabledCapabilities.includes(item.id)}
                      onChange={(event) => {
                        setDisabledCapabilities((values) =>
                          event.target.checked
                            ? values.filter((id) => id !== item.id)
                            : [...values, item.id],
                        );
                      }}
                    />
                    <span>
                      <strong>
                        {item.label}
                        <small>{item.scope === "workspace" ? "当前领域" : "跨领域共享"}</small>
                      </strong>
                      <em>{item.description ?? "为对话提供工具与上下文"}</em>
                    </span>
                  </label>
                ))}
                {capabilities.length === 0 && (
                  <p className="bcr-chat-hint">当前没有可用领域能力，可以直接对话。</p>
                )}
              </div>
            </details>
          </div>
        )}

        {settingsOpen && <EndpointSettings />}
        {!agent.configured && !settingsOpen && (
          <p className="bcr-chat-hint">
            配置 OpenAI 兼容接口后可用。密钥只保存在本页内存，刷新后需重新填写。
          </p>
        )}

        {approval !== null && <ApprovalPrompt approval={approval} />}
        {activity.length > 0 && (
          <div className="bcr-chat-activity" aria-live="polite">
            {activity.map((item) => (
              <span key={item.id}>
                <i />
                {item.name} · {item.status}
              </span>
            ))}
          </div>
        )}

        <ThreadPrimitive.Root className="bcr-chat-thread">
          <ThreadPrimitive.Viewport className="bcr-chat-viewport">
            <ThreadPrimitive.Empty>
              <p className="bcr-chat-empty">
                <span className="bcr-chat-empty-mark">✦</span>
                <strong>从一个问题开始</strong>
                <span>提问、整理思路，或交给我一个任务。当前工作区和共享能力都可以为你所用。</span>
              </p>
            </ThreadPrimitive.Empty>
            <ThreadPrimitive.Messages>
              {({ message }) =>
                message.role === "user" ? (
                  <MessagePrimitive.Root className="bcr-chat-line is-user">
                    <MessagePrimitive.Content components={{ Text: ({ text }) => <p>{text}</p> }} />
                  </MessagePrimitive.Root>
                ) : (
                  <MessagePrimitive.Root className="bcr-chat-line is-agent">
                    <MessagePrimitive.Content
                      components={{
                        Text: renderText ?? (({ text }) => <p className="bcr-chat-text">{text}</p>),
                        tools: {
                          Fallback: ToolChip,
                        },
                      }}
                    />
                    <MessagePrimitive.Error>
                      <div className="bcr-chat-error" role="alert">
                        <strong>本次请求未完成</strong>
                        <ErrorPrimitive.Message />
                        <p>
                          请检查接口、模型和网络。跨域失败时请配置同源代理。已执行的操作不会自动撤销。
                        </p>
                        {message.content.some((part) => part.type === "tool-call") ? (
                          <p>
                            本轮包含工具调用，请先核实上方执行记录，再发送新的指令，避免重复操作。
                          </p>
                        ) : (
                          <ActionBarPrimitive.Reload className="bcr-chat-button">
                            重试
                          </ActionBarPrimitive.Reload>
                        )}
                        <button
                          type="button"
                          className="bcr-chat-button"
                          onClick={() => setSettingsOpen(true)}
                        >
                          检查接口
                        </button>
                      </div>
                    </MessagePrimitive.Error>
                  </MessagePrimitive.Root>
                )
              }
            </ThreadPrimitive.Messages>
          </ThreadPrimitive.Viewport>
          <ComposerPrimitive.Root className="bcr-chat-composer">
            <ComposerPrimitive.Input
              className="bcr-chat-input"
              placeholder="提问、整理思路，或请我处理当前内容…"
              rows={2}
              submitMode="enter"
            />
            <div className="bcr-chat-composer-actions">
              <ComposerPrimitive.Cancel className="bcr-chat-button">停止</ComposerPrimitive.Cancel>
              <ComposerPrimitive.Send className="bcr-chat-primary">发送</ComposerPrimitive.Send>
            </div>
          </ComposerPrimitive.Root>
        </ThreadPrimitive.Root>
      </div>
    </AssistantRuntimeProvider>
  );
}

/**
 * Any tool a surface contributed.
 *
 * Rendered by name and value, not by a hard-coded list: a domain can add a
 * capability and see it in the transcript without the panel learning about it.
 */
function ToolChip({
  toolName,
  result,
  isError,
}: ToolCallMessagePartProps<Record<string, unknown>>) {
  return (
    <details className="bcr-chat-card bcr-chat-tool" aria-label={`工具 ${toolName}`}>
      <summary className="bcr-chat-card-head">
        <span>{isError ? "执行失败" : result === undefined ? "执行中" : "执行记录"}</span>
        <span>{toolName}</span>
      </summary>
      {result === undefined ? (
        <p className="bcr-chat-hint" role="status">
          执行中…
        </p>
      ) : (
        <pre className="bcr-chat-diff">{JSON.stringify(result, null, 2)}</pre>
      )}
    </details>
  );
}

/**
 * The approval the loop is waiting on.
 *
 * Approving writes through the surface's own storage path, which is what keeps
 * the domain's guarantees — a revision in 历史 for notes — instead of a second
 * writer bypassing them.
 */
function ApprovalPrompt({ approval }: { approval: PendingApproval }) {
  const suggestion = approval.suggestion;
  return (
    <div className="bcr-chat-card" role="group" aria-label="待确认的操作">
      <div className="bcr-chat-card-head">
        <span>需要你确认</span>
        <span>{approval.targetLabel}</span>
      </div>
      {suggestion ? (
        <pre className="bcr-chat-diff">{`- ${approval.original || "(空)"}\n+ ${suggestion.replacement}`}</pre>
      ) : (
        <pre className="bcr-chat-diff">{JSON.stringify(approval.call.input ?? {}, null, 2)}</pre>
      )}
      <div className="bcr-chat-card-actions">
        <button type="button" className="bcr-chat-primary" onClick={() => approval.settle(true)}>
          {suggestion ? "应用修改" : "允许执行"}
        </button>
        <button type="button" className="bcr-chat-button" onClick={() => approval.settle(false)}>
          放弃
        </button>
      </div>
    </div>
  );
}

function EndpointSettings() {
  const agent = useAgent();
  const [baseUrl, setBaseUrl] = useState(agent.endpoint.baseUrl);
  const [apiKey, setApiKey] = useState(agent.endpoint.apiKey);
  const [model, setModel] = useState(agent.endpoint.model);
  return (
    <form
      className="bcr-chat-settings"
      onSubmit={(event) => {
        event.preventDefault();
        agent.setEndpoint({ baseUrl, apiKey, model });
      }}
    >
      <label>
        接口地址
        <input
          aria-label="AI 接口地址"
          placeholder="http://127.0.0.1:11434/v1"
          value={baseUrl}
          onChange={(event) => setBaseUrl(event.target.value)}
        />
      </label>
      <label>
        模型
        <input
          aria-label="AI 模型名称"
          placeholder="gpt-4o-mini"
          value={model}
          onChange={(event) => setModel(event.target.value)}
        />
      </label>
      <label>
        密钥
        <input
          aria-label="AI 接口密钥"
          type="password"
          placeholder="本地接口可留空"
          value={apiKey}
          onChange={(event) => setApiKey(event.target.value)}
        />
      </label>
      <button type="submit" className="bcr-chat-button">
        保存到本次会话
      </button>
      <p className="bcr-chat-hint">
        支持同源路径，例如
        /api/llm/v1（需服务端启用代理）。直接连接本地接口时，网关必须允许当前页面跨域访问。
      </p>
    </form>
  );
}
