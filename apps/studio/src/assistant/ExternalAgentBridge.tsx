import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { Button, Dialog, useAgentHost, useRuntime, useUpdateParticipant } from "@bcr/react";
import { BrowserBridge } from "@bcr/agent/bridge";
import { Schema } from "effect";
import { Cable, Check, Circle } from "lucide-react";
import { workspaceServices } from "../workspace";
import { ArtifactSchema } from "../workspace/files";
import "./external-agent.css";

function workspaceIdentity() {
  const key = "bcr/bridge-workspace/v1";
  try {
    let id = localStorage.getItem(key);
    if (!id || !/^[a-zA-Z0-9_-]{1,100}$/u.test(id)) {
      id = crypto.randomUUID();
      localStorage.setItem(key, id);
    }
    return id;
  } catch {
    return crypto.randomUUID();
  }
}

/** Stays mounted with the workspace; closing the settings panel keeps its connection alive. */
export function ExternalAgentBridge({
  open,
  onClose,
  onConnected,
}: {
  open: boolean;
  onClose: () => void;
  onConnected: (connected: boolean) => void;
}) {
  const host = useAgentHost(),
    runtime = useRuntime();
  const bridge = useMemo(
    () =>
      new BrowserBridge({
        workspace: workspaceIdentity(),
        label: `BCR · ${location.origin}`,
        capabilities: host.agentCapabilities,
        subscribe: host.subscribeAgentCapabilities,
        files: {
          capability: "workspace.works",
          read: (artifact) =>
            workspaceServices(runtime).files.read(
              Schema.decodeUnknownSync(ArtifactSchema)(artifact),
            ),
          import: (blob, name, signal) =>
            workspaceServices(runtime).files.import(blob, name, signal),
        },
      }),
    [host, runtime],
  );
  const state = useSyncExternalStore(bridge.subscribe, bridge.getSnapshot);
  const capabilities = useSyncExternalStore(
    host.subscribeAgentCapabilities,
    host.agentCapabilities,
  ).filter((c) => c.scope === "shared" && (c.available?.() ?? true));
  const [address, setAddress] = useState("http://127.0.0.1:5209"),
    [token, setToken] = useState("");
  const [selected, setSelected] = useState(["knowledge.library", "workspace.works"]),
    [write, setWrite] = useState(false),
    [error, setError] = useState("");
  const connected = state.status === "connected",
    locked = state.status !== "disconnected";
  useEffect(() => {
    onConnected(connected);
  }, [connected, onConnected]);
  useEffect(() => {
    const leave = () => bridge.disconnect();
    window.addEventListener("pagehide", leave);
    return () => {
      window.removeEventListener("pagehide", leave);
      bridge.disconnect();
    };
  }, [bridge]);
  useUpdateParticipant({
    blocked: () =>
      bridge.getSnapshot().pending > 0 ? "外部 Agent 正在执行操作，请等待完成后更新。" : null,
    save: async () => {
      bridge.disconnect("应用更新，连接已断开");
    },
  });
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="外部 Agent"
      closeLabel="关闭外部 Agent 面板"
      className="external-agent-dialog"
    >
      <div className="external-agent-intro">
        <Cable size={28} aria-hidden="true" />
        <div>
          <p className="external-agent-kicker">BCR × MCP</p>
          <h3>让助手进入你的工作区</h3>
          <p>连接 Codex、Claude Code，共用资料与作品，生成自己的交互页面。</p>
        </div>
      </div>
      <div className="external-agent-status" data-connected={connected} role="status">
        {connected ? <Check size={16} /> : <Circle size={12} />}
        <span>{state.message}</span>
        {connected && <small>{state.tools} 项工具</small>}
      </div>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (locked) return;
          setError("");
          try {
            bridge.connect(address.trim(), token.trim(), {
              capabilities: selected.filter((id) => capabilities.some((c) => c.id === id)),
              write,
            });
          } catch (reason) {
            setError(String(reason instanceof Error ? reason.message : reason));
          }
        }}
      >
        <fieldset disabled={locked} className="external-agent-fields">
          <label>
            本机服务地址
            <input
              aria-label="Bridge 服务地址"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              required
              spellCheck={false}
            />
          </label>
          <label>
            连接密钥
            <input
              aria-label="Bridge 连接密钥"
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              autoComplete="off"
              required
            />
          </label>
          <fieldset className="external-agent-grants">
            <legend>允许访问的能力</legend>
            {capabilities.map((c) => (
              <label key={c.id}>
                <input
                  type="checkbox"
                  checked={selected.includes(c.id)}
                  onChange={(e) =>
                    setSelected((previous) =>
                      e.target.checked ? [...previous, c.id] : previous.filter((id) => id !== c.id),
                    )
                  }
                />
                <span>{c.label}</span>
                <small>{c.tools.length} 项工具</small>
              </label>
            ))}
          </fieldset>
          <label className="external-agent-write">
            <input type="checkbox" checked={write} onChange={(e) => setWrite(e.target.checked)} />
            <span>
              允许编辑与导入
              <small>本次连接内执行所选能力的写入操作，仍检查版本冲突与未保存内容。</small>
            </span>
          </label>
        </fieldset>
        {error && (
          <p role="alert" className="external-agent-error">
            {error}
          </p>
        )}
        <div className="external-agent-actions">
          {locked ? (
            <Button
              type="button"
              variant="ghost"
              onClick={(event) => {
                event.preventDefault();
                bridge.disconnect();
              }}
            >
              断开连接
            </Button>
          ) : (
            <Button type="submit">连接工作区</Button>
          )}
          <span>关闭面板后继续连接；关闭页面后断开。</span>
        </div>
      </form>
      <details className="external-agent-help">
        <summary>首次连接</summary>
        <ol>
          <li>
            在 BCR 项目目录运行 <code>bun run bridge</code>。
          </li>
          <li>
            运行 <code>bun run bridge token browser</code>，将密钥填入上方。
          </li>
          <li>
            在外部助手中添加 MCP 地址 <code>{address.replace(/\/$/u, "")}/mcp</code>，使用{" "}
            <code>token agent</code> 返回的独立凭据。
          </li>
        </ol>
        <p>
          当前浏览器来源：<code>{location.origin}</code>。来源不同时，启动命令增加{" "}
          <code>--origin {location.origin}</code>。
        </p>
        <p>
          连接密钥仅保留在此页面内存中。文件导入、下载和客户端配置见仓库文档{" "}
          <code>docs/EXTERNAL-AGENTS.md</code>。
        </p>
      </details>
      {state.activity.length > 0 && (
        <section className="external-agent-log" aria-label="外部 Agent 最近操作">
          <h3>最近操作</h3>
          <ul>
            {state.activity.map((a) => (
              <li key={a.id}>
                <code>{a.name}</code>
                <span>
                  {a.status === "running"
                    ? "执行中"
                    : a.status === "completed"
                      ? "已完成"
                      : "未完成"}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </Dialog>
  );
}
