import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ComponentType,
} from "react";
import { Plus } from "lucide-react";
import { useAgent, useAgentHost } from "@bcr/react";
import { AgentTimeline } from "./AgentTimeline";
import { AgentComposer } from "./AgentComposer";
import { AgentContextBar } from "./AgentContextBar";
import { EndpointSettings } from "./EndpointSettings";
import type { ResultRegistry } from "./renderers";
import "./agent.css";

/** A replaceable view over host-owned conversations, usable in any container. */
export function AgentConversation({
  renderText,
  renderers,
}: {
  renderText?: ComponentType<{ text: string }>;
  renderers?: ResultRegistry;
}) {
  const { conversations: manager } = useAgentHost();
  const state = useSyncExternalStore(manager.subscribe, manager.getSnapshot, manager.getSnapshot);
  const conversation = state.conversations.find((item) => item.id === state.activeId)!;
  const agent = useAgent();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsTrigger = useRef<HTMLButtonElement>(null);
  const wasSettingsOpen = useRef(false);
  useLayoutEffect(() => {
    const restore = wasSettingsOpen.current && !settingsOpen;
    wasSettingsOpen.current = settingsOpen;
    if (!restore) return;
    // Let the browser remove the inert subtree before restoring keyboard focus.
    const frame = requestAnimationFrame(() => settingsTrigger.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [settingsOpen]);
  const [actionError, setActionError] = useState<string | null>(null);
  const openSettings = useCallback(() => setSettingsOpen(true), []);
  const runningHere = state.running?.conversationId === conversation.id;
  const send = () => {
    setActionError(null);
    void manager
      .send(conversation.id, conversation.draft)
      .catch((error: unknown) => setActionError(String(error)));
  };
  return (
    <div className="bcr-chat-shell">
      <div
        className="bcr-chat"
        inert={settingsOpen}
        aria-hidden={settingsOpen || undefined}
        style={{ opacity: settingsOpen ? 0 : 1 }}
      >
        <header className="bcr-chat-head">
          <div className="bcr-chat-target">
            <strong>{state.options.workspaceLabel}</strong>
          </div>
          <div className="bcr-chat-session-bar">
            <select
              aria-label="切换对话"
              value={conversation.id}
              disabled={state.loading}
              onChange={(event) => {
                manager.select(event.target.value);
                setActionError(null);
              }}
            >
              {[...state.conversations].reverse().map((item) => (
                <option key={item.id} value={item.id}>
                  {item.title}
                  {state.running?.conversationId === item.id ? " · 进行中" : ""}
                </option>
              ))}
            </select>
          </div>
          <button
            type="button"
            className="bcr-chat-button"
            aria-label="新建对话"
            title="新建对话"
            disabled={state.loading}
            onClick={() => {
              manager.create();
              setActionError(null);
            }}
          >
            <Plus size={17} aria-hidden="true" />
          </button>
        </header>
        {!agent.configured && !settingsOpen && (
          <button type="button" className="bcr-chat-setup" onClick={openSettings}>
            连接模型，开始协作 <span>配置兼容接口 →</span>
          </button>
        )}
        {state.storageError && (
          <p className="bcr-chat-error" role="alert">
            {state.storageError}
          </p>
        )}
        {state.running && !runningHere && (
          <div className="bcr-chat-background" role="status">
            另一个对话正在执行任务。
            <button
              className="bcr-chat-button"
              onClick={() => manager.select(state.running!.conversationId)}
            >
              查看任务
            </button>
          </div>
        )}
        <AgentTimeline
          key={conversation.id}
          conversation={conversation}
          manager={manager}
          renderText={renderText}
          registry={renderers}
          settings={openSettings}
          busy={state.running !== null}
        />
        <div className="bcr-chat-run-status" role="status" aria-live="polite">
          {runningHere
            ? conversation.runs.at(-1)?.status === "awaiting_approval"
              ? "等待你确认操作"
              : "助手正在处理，可随时停止"
            : ""}
        </div>
        {actionError && (
          <p className="bcr-chat-error" role="alert">
            {actionError}
          </p>
        )}
        <AgentContextBar manager={manager} options={state.options} />
        <AgentComposer
          draft={conversation.draft}
          setDraft={(draft) => manager.setDraft(conversation.id, draft)}
          send={send}
          running={runningHere}
          disabled={state.loading || state.running !== null || !agent.configured}
          cancel={() => {
            if (state.running) manager.cancel(state.running.runId);
          }}
          footer={
            <>
              <button
                type="button"
                className="bcr-chat-model"
                ref={settingsTrigger}
                aria-label="接口"
                aria-expanded={settingsOpen}
                title="配置模型接口"
                onClick={() => setSettingsOpen(!settingsOpen)}
              >
                {agent.endpoint.model || "连接模型"} <span aria-hidden="true">⌄</span>
              </button>
              <small>Shift + Enter 换行</small>
            </>
          }
        />
      </div>
      {settingsOpen && (
        <EndpointSettings
          onClose={() => {
            setSettingsOpen(false);
          }}
        />
      )}
    </div>
  );
}
