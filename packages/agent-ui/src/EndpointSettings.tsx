import { useLayoutEffect, useRef, useState } from "react";
import { normalizeEndpointUrl } from "@bcr/agent";
import {
  useAgent,
  useAgentHost,
  CredentialScopeField,
  SecretField,
  ConnectionSummary,
} from "@bcr/react";

function normalized(value: string) {
  try {
    return normalizeEndpointUrl(value);
  } catch {
    return null;
  }
}

export function EndpointSettings({ onClose }: { onClose: () => void }) {
  const agent = useAgent();
  const { settings } = useAgentHost();
  const [editing, setEditing] = useState(!agent.endpoint.baseUrl || agent.persistence.needsKey);
  const [baseUrl, setBaseUrl] = useState(agent.endpoint.baseUrl);
  const [replacement, setReplacement] = useState<string | null>(null);
  const [model, setModel] = useState(agent.endpoint.model);
  const [scope, setScope] = useState(agent.persistence.scope);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [confirm, setConfirm] = useState<"leave" | "clear" | "delete" | null>(null);
  const back = useRef<HTMLButtonElement>(null);
  const confirmation = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (confirm) {
      confirmation.current?.scrollIntoView({ block: "nearest" });
      confirmation.current?.querySelector("button")?.focus();
    }
  }, [confirm]);
  useLayoutEffect(() => {
    back.current?.focus();
  }, []);
  const sameTarget =
    normalized(baseUrl) !== null && normalized(baseUrl) === normalized(agent.endpoint.baseUrl);
  const apiKey = replacement ?? (sameTarget ? agent.endpoint.apiKey : "");
  const dirty =
    baseUrl !== agent.endpoint.baseUrl ||
    model !== agent.endpoint.model ||
    apiKey !== agent.endpoint.apiKey ||
    scope !== agent.persistence.scope;
  function reset() {
    setBaseUrl(agent.endpoint.baseUrl);
    setModel(agent.endpoint.model);
    setReplacement(null);
    setScope(agent.persistence.scope);
    setError(null);
    setMessage("");
    setConfirm(null);
  }
  function leave() {
    if (editing && dirty) setConfirm("leave");
    else onClose();
  }
  return (
    <section
      className="bcr-chat bcr-chat-settings"
      aria-label="模型连接设置"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          leave();
        }
      }}
    >
      <header className="bcr-connection-header">
        <button ref={back} type="button" className="bcr-chat-button" onClick={leave}>
          ← 返回对话
        </button>
        <strong>模型连接</strong>
      </header>
      <form
        className="bcr-connection-form"
        onChange={() => {
          setError(null);
          setMessage("");
          setConfirm(null);
        }}
        onSubmit={(event) => {
          event.preventDefault();
          setError(null);
          setMessage("");
          try {
            agent.setEndpoint({ baseUrl, apiKey, model }, apiKey ? scope : "memory");
            if (settings.getPersistenceSnapshot().error) return;
            setReplacement(null);
            setEditing(false);
            setConfirm(null);
            setMessage("连接已保存。将在下一次请求时使用。");
          } catch {
            setError("接口地址无效：请使用 HTTP(S) 地址或同源路径，不要包含凭据、查询参数或片段。");
          }
        }}
      >
        <div className="bcr-connection-body">
          {!editing ? (
            <>
              <ConnectionSummary
                title={agent.endpoint.model}
                detail={agent.endpoint.baseUrl}
                status={
                  agent.persistence.needsKey
                    ? "需要补充密钥"
                    : agent.endpoint.apiKey
                      ? `密钥已配置 · ${agent.persistence.scope === "device" ? "记住此设备" : agent.persistence.scope === "session" ? "当前标签页" : "仅本页"}`
                      : "未使用密钥"
                }
              >
                <button
                  type="button"
                  className="bcr-chat-button"
                  onClick={() => {
                    reset();
                    setEditing(true);
                  }}
                >
                  编辑连接
                </button>
              </ConnectionSummary>
              <p className="bcr-chat-hint">
                配置已保存不代表连通性已验证。地址与模型会在此浏览器保留。
              </p>
              <details className="bcr-connection-manage">
                <summary>管理连接</summary>
                <div className="bcr-chat-card-actions">
                  <button
                    type="button"
                    className="bcr-chat-button"
                    disabled={!agent.endpoint.apiKey && !agent.persistence.needsKey}
                    onClick={() => setConfirm("clear")}
                  >
                    清除已保存密钥
                  </button>
                  <button
                    type="button"
                    className="bcr-chat-button"
                    onClick={() => setConfirm("delete")}
                  >
                    删除连接
                  </button>
                </div>
              </details>
            </>
          ) : (
            <>
              <div>
                <h3>连接你的模型</h3>
                <p className="bcr-chat-hint">支持兼容接口，也可使用无需密钥的本地网关。</p>
              </div>
              <label>
                接口地址
                <input
                  required
                  aria-label="AI 接口地址"
                  placeholder="/api/llm/v1"
                  value={baseUrl}
                  onChange={(event) => {
                    const next = event.target.value;
                    if (normalized(next) !== normalized(baseUrl)) {
                      setReplacement(null);
                      setScope("memory");
                    }
                    setBaseUrl(next);
                  }}
                />
              </label>
              <label>
                模型
                <input
                  required
                  aria-label="AI 模型名称"
                  placeholder="mimo-v2.6-pro"
                  value={model}
                  onChange={(event) => setModel(event.target.value)}
                />
              </label>
              <SecretField
                key={normalized(baseUrl) ?? baseUrl}
                label="AI 接口密钥"
                saved={sameTarget && !!agent.endpoint.apiKey}
                value={replacement}
                onChange={setReplacement}
                placeholder="本地接口可留空"
              />
              {!sameTarget && agent.endpoint.apiKey && (
                <p className="bcr-chat-hint">接口目标已更改，原密钥不会发送到新地址。</p>
              )}
              <CredentialScopeField
                label="AI 密钥保存范围"
                value={scope}
                onChange={setScope}
                disabled={!apiKey}
              />
              {agent.persistence.needsKey && (
                <p role="status">连接已恢复，请重新填写密钥，或选择无需密钥的本地接口。</p>
              )}
              <p className="bcr-chat-hint">
                同源路径需服务端启用代理；直连接口须允许跨域访问。更换接口目标后需重新填写密钥。
              </p>
            </>
          )}
          {(error || agent.persistence.error) && (
            <p role="alert">{error || agent.persistence.error}</p>
          )}
          {message && !agent.persistence.error && <p role="status">{message}</p>}
          {confirm && (
            <div ref={confirmation} className="bcr-connection-confirm" role="alert">
              <p>
                {confirm === "leave"
                  ? "有未保存的修改，是否放弃并返回对话？"
                  : confirm === "clear"
                    ? "清除本连接密钥？地址和模型会保留。"
                    : "删除连接及其保存的密钥？对话记录不会删除。"}
              </p>
              <div className="bcr-chat-card-actions">
                <button type="button" className="bcr-chat-button" onClick={() => setConfirm(null)}>
                  继续保留
                </button>
                <button
                  type="button"
                  className="bcr-chat-button"
                  onClick={() => {
                    if (confirm === "leave") {
                      onClose();
                      return;
                    }
                    agent.setEndpoint(
                      confirm === "clear" ? { ...agent.endpoint, apiKey: "" } : null,
                      "memory",
                    );
                    if (settings.getPersistenceSnapshot().error) return;
                    setConfirm(null);
                    setReplacement(null);
                    setScope("memory");
                    if (confirm === "delete") {
                      setBaseUrl("");
                      setModel("");
                      setEditing(true);
                    }
                    setMessage(confirm === "clear" ? "密钥已清除。" : "连接已删除。");
                  }}
                >
                  {confirm === "leave" ? "放弃修改" : confirm === "clear" ? "确认清除" : "确认删除"}
                </button>
              </div>
            </div>
          )}
        </div>
        {editing && (
          <footer className="bcr-connection-footer">
            <span>{dirty ? "有未保存的修改" : "修改后保存生效"}</span>
            <button
              type="button"
              className="bcr-chat-button"
              onClick={() => {
                reset();
                if (agent.endpoint.baseUrl) setEditing(false);
                else onClose();
              }}
            >
              取消
            </button>
            <button
              type="submit"
              className="bcr-chat-button is-primary"
              disabled={!dirty && !agent.persistence.needsKey}
            >
              保存连接
            </button>
          </footer>
        )}
      </form>
    </section>
  );
}
