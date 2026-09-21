import { useState } from "react";
import type { TextEditSuggestion } from "@bcr/agent";
import { useAgent, type ProposeInput, type SuggestionState } from "./agent";
import "./agent.css";

/**
 * The AI editing affordance, shared by every workspace.
 *
 * Generic over the text being edited: the caller says how to address a range and
 * where the accepted result goes; preview, staleness and discard come from
 * {@link useTextEditSuggestion}. A domain that edits text therefore supplies two
 * callbacks rather than a panel.
 *
 * Styling lives in this package's stylesheet, so every host gets the same result
 * without copying classes.
 */
export interface AgentEditPanelProps {
  /** The text the range addresses, as it is right now. */
  readonly text: string;
  /** Human description of the range, e.g. "改写选中 12 字符". */
  readonly scope: string;
  /** Heading for context, e.g. a note title or block label. */
  readonly label?: string;
  /** The shared controller from {@link useTextEditSuggestion}. */
  readonly state: SuggestionState;
  readonly notice: string;
  readonly onPropose: (input: Omit<ProposeInput, "text" | "start" | "end" | "label">) => void;
  readonly onAccept: (suggestion: TextEditSuggestion) => void;
  readonly onDiscard: () => void;
  readonly disabled?: boolean;
  /** Placeholder for the instruction field; domains word it for their content. */
  readonly placeholder?: string;
}

export function AgentEditPanel({
  text,
  scope,
  state,
  notice,
  onPropose,
  onAccept,
  onDiscard,
  disabled = false,
  placeholder = "例如：改写得更简洁，保留结论",
}: AgentEditPanelProps) {
  const agent = useAgent();
  const [instruction, setInstruction] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const asking = state.status === "asking";
  const ready = state.status === "ready" ? state.suggestion : null;
  const blocked = disabled || asking || !instruction.trim() || !agent.configured;

  const ask = (mode: "rewrite" | "continue") => {
    if (instruction.trim()) onPropose({ mode, instruction });
  };

  return (
    <div className="bcr-agent">
      <div className="bcr-agent-bar">
        <span className="bcr-agent-scope" title="编辑范围由光标或选区决定">
          {scope}
        </span>
        <input
          className="bcr-agent-instruction"
          aria-label="告诉 AI 如何编辑这段内容"
          placeholder={placeholder}
          value={instruction}
          disabled={disabled || asking}
          maxLength={2_000}
          onChange={(event) => setInstruction(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              ask("rewrite");
            }
          }}
        />
        <button
          type="button"
          className="bcr-agent-button"
          disabled={blocked}
          onClick={() => ask("rewrite")}
        >
          {asking ? "生成中…" : "改写"}
        </button>
        <button
          type="button"
          className="bcr-agent-button"
          disabled={blocked}
          onClick={() => ask("continue")}
        >
          续写
        </button>
        <button
          type="button"
          className="bcr-agent-button"
          aria-label="AI 接口设置"
          aria-pressed={settingsOpen}
          onClick={() => setSettingsOpen(!settingsOpen)}
        >
          接口
        </button>
      </div>
      {settingsOpen && <AgentSettings />}
      {!agent.configured && !settingsOpen && (
        <p className="bcr-agent-hint">
          配置 OpenAI 兼容接口后可用；密钥只保存在本页内存，刷新后需重新填写。
        </p>
      )}
      {state.status === "failed" && (
        <p className="bcr-agent-error" role="alert">
          {state.message}
        </p>
      )}
      {notice && (
        <p className="bcr-agent-hint" role="status">
          {notice}
        </p>
      )}
      {ready && (
        <div className="bcr-agent-preview" role="group" aria-label="待应用的改动">
          <div className="bcr-agent-preview-head">
            <span>待应用 · {ready.summary}</span>
            <span>{describeRange(ready)}</span>
          </div>
          <pre className="bcr-agent-diff">{diffOf(ready, text)}</pre>
          <div className="bcr-agent-preview-actions">
            <button type="button" className="bcr-agent-primary" onClick={() => onAccept(ready)}>
              应用
            </button>
            <button type="button" className="bcr-agent-button" onClick={onDiscard}>
              放弃
            </button>
            <span className="bcr-agent-hint">应用前的版本会保留，可撤销或从历史恢复</span>
          </div>
        </div>
      )}
    </div>
  );
}

/** Endpoint settings. Memory-only, matching how other credentials are handled. */
export function AgentSettings() {
  const agent = useAgent();
  const [baseUrl, setBaseUrl] = useState(agent.endpoint.baseUrl);
  const [apiKey, setApiKey] = useState(agent.endpoint.apiKey);
  const [model, setModel] = useState(agent.endpoint.model);
  return (
    <form
      className="bcr-agent-settings"
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
      <div>
        <button type="submit" className="bcr-agent-button">
          保存到本次会话
        </button>
        <button
          type="button"
          className="bcr-agent-button"
          onClick={() => {
            setBaseUrl("");
            setApiKey("");
            setModel("");
            agent.setEndpoint(null);
          }}
        >
          清除
        </button>
      </div>
    </form>
  );
}

function describeRange(suggestion: TextEditSuggestion): string {
  const size = suggestion.range.end - suggestion.range.start;
  return size === 0
    ? `插入 ${suggestion.replacement.length} 字符`
    : `替换 ${size} → ${suggestion.replacement.length} 字符`;
}

/** The affected region with a little context, so the preview shows what changes. */
function diffOf(suggestion: TextEditSuggestion, text: string): string {
  const { start, end } = suggestion.range;
  const context = 60;
  const from = Math.max(0, start - context);
  const head = from > 0 ? "…" : "";
  const lead = text.slice(from, start);
  const trailing = end + context < text.length ? "…" : "";
  return [
    `- ${head}${truncate(lead + text.slice(start, end), 240)}`,
    `+ ${head}${truncate(lead + suggestion.replacement, 240)}${trailing}`,
  ].join("\n");
}

const truncate = (value: string, limit: number) =>
  value.length > limit ? `${value.slice(0, limit)}…` : value;
