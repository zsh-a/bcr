import { useState } from "react";
import {
  AssistantRuntimeProvider,
  ComposerPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  type ToolCallMessagePartProps,
} from "@assistant-ui/react";
import { activeSurface, subscribeSurfaces, surfaceSummary } from "@bcr/agent";
import { useSyncExternalStore } from "react";
import { applySurfaceEdit, SURFACE_EDIT_TOOL, useAgentChat } from "./chat";
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
export function AgentChatPanel() {
  const [mode, setMode] = useState<"rewrite" | "continue">("rewrite");
  const runtime = useAgentChat(mode);
  const agent = useAgent();
  const surface = useSyncExternalStore(subscribeSurfaces, surfaceSummary, () => null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <div className="bcr-chat">
        <header className="bcr-chat-head">
          <div className="bcr-chat-target">
            <span className="bcr-chat-eyebrow">TARGET</span>
            <strong>{surface?.label ?? "没有活动目标"}</strong>
            <small>{surface?.scope ?? "打开要修改的内容后重试"}</small>
          </div>
          <div className="bcr-chat-modes" role="group" aria-label="编辑方式">
            <button
              type="button"
              aria-pressed={mode === "rewrite"}
              onClick={() => setMode("rewrite")}
            >
              改写
            </button>
            <button
              type="button"
              aria-pressed={mode === "continue"}
              onClick={() => setMode("continue")}
            >
              续写
            </button>
            <button
              type="button"
              aria-pressed={settingsOpen}
              onClick={() => setSettingsOpen(!settingsOpen)}
            >
              接口
            </button>
          </div>
        </header>

        {settingsOpen && <EndpointSettings />}
        {!agent.configured && !settingsOpen && (
          <p className="bcr-chat-hint">
            配置 OpenAI 兼容接口后可用。密钥只保存在本页内存，刷新后需重新填写。
          </p>
        )}

        <ThreadPrimitive.Root className="bcr-chat-thread">
          <ThreadPrimitive.Viewport className="bcr-chat-viewport">
            <ThreadPrimitive.Empty>
              <p className="bcr-chat-empty">
                说清要改什么，改动会先作为一张卡片出现，确认后才写入。
                <br />
                例如：「把这一段改得更简洁，保留结论。」
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
                        Text: ({ text }) => <p className="bcr-chat-text">{text}</p>,
                        // The edit card: an explicit apply step, never a silent write.
                        tools: { by_name: { [SURFACE_EDIT_TOOL]: EditCard } },
                      }}
                    />
                  </MessagePrimitive.Root>
                )
              }
            </ThreadPrimitive.Messages>
          </ThreadPrimitive.Viewport>
          <ComposerPrimitive.Root className="bcr-chat-composer">
            <ComposerPrimitive.Input
              className="bcr-chat-input"
              placeholder="告诉 AI 要如何修改…"
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
 * A proposed edit, held until applied.
 *
 * Rendering the diff and applying it live here rather than in the runtime, so
 * the thread scrolls back to a past card and can still apply it — subject to the
 * version check, which is what makes that safe.
 */
function EditCard({ args }: ToolCallMessagePartProps<Record<string, unknown>>) {
  const [outcome, setOutcome] = useState("");
  const suggestion = args as {
    range?: { start: number; end: number };
    replacement?: string;
    summary?: string;
  };
  const range = suggestion.range;
  const active = activeSurface();
  const target = active?.read() ?? null;
  const removed = range && target ? target.text.slice(range.start, range.end) : "";
  return (
    <div className="bcr-chat-card" role="group" aria-label="待应用的改动">
      <div className="bcr-chat-card-head">
        <span>待应用</span>
        <span>{suggestion.summary ?? ""}</span>
      </div>
      <pre className="bcr-chat-diff">
        {`- ${removed || "(空)"}\n+ ${suggestion.replacement ?? ""}`}
      </pre>
      {outcome ? (
        <p className="bcr-chat-hint" role="status">
          {outcome}
        </p>
      ) : (
        <div className="bcr-chat-card-actions">
          <button
            type="button"
            className="bcr-chat-primary"
            onClick={() => setOutcome(applySurfaceEdit(args))}
          >
            应用
          </button>
          <button type="button" className="bcr-chat-button" onClick={() => setOutcome("已放弃")}>
            放弃
          </button>
        </div>
      )}
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
    </form>
  );
}
