import { useSyncExternalStore } from "react";
import { useAgentHost } from "@bcr/react";
import type { AgentConversations, AgentSessionOptions } from "@bcr/agent";

export function AgentContextBar({
  manager,
  options,
}: {
  manager: AgentConversations;
  options: AgentSessionOptions;
}) {
  const host = useAgentHost();
  const surface = useSyncExternalStore(host.subscribeSurfaces, host.surfaceSummary, () => null);
  useSyncExternalStore(
    host.subscribeAgentCapabilities,
    host.agentCapabilities,
    host.agentCapabilities,
  );
  const capabilities = host.availableAgentCapabilities(options.workspaceId);
  const enabled = capabilities.filter((item) => !options.disabledCapabilities.includes(item.id));
  return (
    <div className="bcr-chat-context" aria-label="可用能力">
      {surface && (
        <>
          <button
            type="button"
            className="ui-btn ui-btn-ghost bcr-chat-context-pill"
            aria-pressed={options.includeContext}
            title={surface.label}
            onClick={() => manager.setOptions({ includeContext: !options.includeContext })}
          >
            当前内容{options.includeContext ? " ✓" : ""}
          </button>
          <button
            type="button"
            className="ui-btn ui-btn-ghost bcr-chat-context-pill"
            aria-pressed={options.allowEdits !== false}
            disabled={!options.includeContext}
            onClick={() => manager.setOptions({ allowEdits: options.allowEdits === false })}
          >
            允许修改当前内容{options.allowEdits !== false ? " ✓" : ""}
          </button>
        </>
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
                checked={!options.disabledCapabilities.includes(item.id)}
                onChange={(event) =>
                  manager.setOptions({
                    disabledCapabilities: event.target.checked
                      ? options.disabledCapabilities.filter((id) => id !== item.id)
                      : [...options.disabledCapabilities, item.id],
                  })
                }
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
            <p className="bcr-chat-hint">当前可直接对话，尚无领域工具。</p>
          )}
          <p className="bcr-chat-hint">
            当前内容的编辑开关不控制共享工具。知识库等共享能力的写入仍需逐次确认。
          </p>
        </div>
      </details>
    </div>
  );
}
