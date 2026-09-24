import { useRef, useState } from "react";
import {
  Button,
  Input,
  SecretField,
  ConnectionSummary,
  useAgentHost,
  useCredential,
} from "@bcr/react";
import { knowledgeCredentialId } from "./credential";
import { pendingCount, type KnowledgeState, type KnowledgeConflict } from "./model";
import type { KnowledgeStore } from "./store";
import { GitHubKnowledge } from "./github";
import { parseRepository } from "./repository";
import { syncKnowledge } from "./sync";

export function KnowledgeSyncPanel({
  state,
  store,
  token,
  auto,
  setAuto,
  syncing,
  onError,
  flush,
  onSync,
}: {
  state: KnowledgeState;
  store: KnowledgeStore;
  token: string;
  auto: boolean;
  setAuto: (value: boolean) => void;
  syncing: boolean;
  onError: (value: string) => void;
  flush: () => Promise<void>;
  onSync: () => Promise<void>;
}) {
  const { credentials } = useAgentHost();
  const credential = useCredential(knowledgeCredentialId(state.sync.target));
  const [replacement, setReplacement] = useState<string | null>(null);
  const [editing, setEditing] = useState(!state.sync.target || !token);
  const [confirm, setConfirm] = useState<"clear" | "disconnect" | null>(null);
  const [scope, setScope] = useState<"memory" | "device">(
    credential.scope === "device" ? "device" : "memory",
  );
  const addressOf = () =>
    state.sync.target ? `${state.sync.target.owner}/${state.sync.target.repo}` : "";
  const [address, setAddress] = useState(addressOf),
    [branch, setBranch] = useState(state.sync.target?.branch ?? "");
  const locked = useRef(false);
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  let identity = null;
  try {
    identity = parseRepository(address);
  } catch {
    /* Validate on submission. */
  }
  const sameTarget =
    !!identity && knowledgeCredentialId(identity) === knowledgeCredentialId(state.sync.target);
  const draftToken = replacement ?? (sameTarget ? token : "");
  function reset() {
    setAddress(addressOf());
    setBranch(state.sync.target?.branch ?? "");
    setReplacement(null);
    setScope(credential.scope === "device" ? "device" : "memory");
    setMessage("");
    setConfirm(null);
    onError("");
  }
  async function action(fn: () => Promise<void>) {
    if (locked.current || syncing) return;
    locked.current = true;
    setBusy(true);
    setMessage("");
    onError("");
    try {
      await fn();
    } catch (error) {
      onError(String(error));
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }
  return (
    <section
      className="knowledge-panel knowledge-sync"
      aria-label="GitHub 同步设置"
      aria-busy={busy || syncing}
    >
      {editing && (
        <p>连接一个已添加 README 的私有仓库。首次同步会合并本机与远端笔记，不会覆盖整个仓库。</p>
      )}
      {!editing && state.sync.target && (
        <ConnectionSummary
          title={`${state.sync.target.owner}/${state.sync.target.repo}`}
          detail={`${state.sync.target.branch} · ${pendingCount(state)} 项待同步`}
          status={token ? "Token 已配置" : "需要补充 Token"}
        >
          <Button
            variant="ghost"
            disabled={busy || syncing || !token}
            onClick={() => void action(onSync)}
          >
            {busy || syncing ? "同步中…" : "立即同步"}
          </Button>
        </ConnectionSummary>
      )}
      <form
        onChange={() => {
          setMessage("");
          onError("");
          setConfirm(null);
        }}
        onSubmit={(e) => {
          e.preventDefault();
          void action(async () => {
            const remote = await GitHubKnowledge.connect(address, draftToken, branch);
            const target = remote.target;
            const previousId = knowledgeCredentialId(state.sync.target),
              nextId = knowledgeCredentialId(target);
            await flush();
            const previous = credentials.get(nextId);
            const result = credentials.save(nextId, draftToken, scope);
            try {
              if (result.error) throw new Error(result.error);
              await store.configure(target);
            } catch (error) {
              credentials.save(nextId, previous.value, previous.scope);
              throw error;
            }
            if (previousId !== nextId && state.sync.target) {
              const removed = credentials.save(previousId, "", "memory");
              if (removed.error) throw new Error(removed.error);
            }
            setAddress(`${target.owner}/${target.repo}`);
            setBranch(target.branch);
            setReplacement(null);
            setEditing(false);
            const outcome = await syncKnowledge(store, remote, flush);
            setMessage(
              outcome === "conflicts"
                ? "连接成功，请先处理下方的内容冲突。"
                : pendingCount(store.getSnapshot())
                  ? "本批已同步，新修改等待下一次同步"
                  : "已与 GitHub 同步",
            );
          });
        }}
      >
        {editing && (
          <fieldset disabled={busy || syncing}>
            <label>
              仓库地址
              <Input
                aria-label="GitHub 仓库地址"
                autoComplete="off"
                placeholder="https://github.com/you/notes"
                spellCheck={false}
                value={address}
                onChange={(e) => {
                  setAddress(e.target.value);
                  setReplacement(null);
                  setScope("memory");
                  setBranch("");
                }}
                required
              />
            </label>
            <SecretField
              key={knowledgeCredentialId(identity)}
              label="GitHub Token"
              saved={sameTarget && !!token}
              value={replacement}
              onChange={setReplacement}
              placeholder="仅授权此仓库的 Contents 读写权限"
            />
            <label className="knowledge-checkbox">
              <input
                type="checkbox"
                checked={scope === "device"}
                onChange={(e) => setScope(e.target.checked ? "device" : "memory")}
              />
              记住此设备
            </label>
            <p className="knowledge-small">
              仅在个人设备上勾选。Token 保存在此浏览器中，未加密；不勾选则关闭页面后需重新填写。
            </p>
            <details className="bcr-connection-manage">
              <summary>高级设置</summary>
              <label>
                分支
                <Input
                  aria-label="GitHub 分支"
                  autoComplete="off"
                  value={branch}
                  onChange={(e) => setBranch(e.target.value)}
                  placeholder="留空自动使用默认分支"
                />
              </label>
            </details>
            {credential.error && <p role="alert">{credential.error}</p>}
            <div className="knowledge-panel-actions">
              {state.sync.target && (
                <Button
                  variant="ghost"
                  onClick={() => {
                    reset();
                    if (state.sync.target) setEditing(false);
                  }}
                >
                  取消
                </Button>
              )}
              <Button
                type="submit"
                variant="primary"
                disabled={busy || syncing || !address.trim() || !draftToken.trim()}
              >
                {busy ? "连接并同步中…" : "连接并同步"}
              </Button>
            </div>
          </fieldset>
        )}
        {!editing && (
          <details className="bcr-connection-manage">
            <summary>管理连接</summary>
            <div className="knowledge-panel-actions">
              <Button
                variant="ghost"
                disabled={busy || syncing}
                onClick={() => {
                  reset();
                  setEditing(true);
                }}
              >
                编辑连接
              </Button>
              <Button
                variant="ghost"
                disabled={busy || syncing}
                onClick={() => setConfirm("clear")}
              >
                清除 Token
              </Button>
              {state.sync.target && (
                <Button
                  variant="ghost"
                  disabled={busy || syncing}
                  onClick={() => setConfirm("disconnect")}
                >
                  断开连接
                </Button>
              )}
            </div>
          </details>
        )}
        {confirm && (
          <div role="alert" className="bcr-connection-confirm">
            <p>
              {confirm === "clear"
                ? "清除 Token？仓库配置会保留。"
                : "断开连接并清除 Token？本地笔记不会删除。"}
            </p>
            <div className="knowledge-panel-actions">
              <Button variant="ghost" disabled={busy || syncing} onClick={() => setConfirm(null)}>
                继续保留
              </Button>
              <Button
                variant="danger"
                disabled={busy || syncing}
                onClick={() => {
                  if (confirm === "clear") {
                    setMessage("");
                    onError("");
                    const result = credentials.save(
                      knowledgeCredentialId(state.sync.target),
                      "",
                      "memory",
                    );
                    setReplacement(null);
                    setScope("memory");
                    setAuto(false);
                    if (result.error) onError(result.error);
                    else {
                      setMessage("Token 已清除，仓库配置仍保留。");
                      setConfirm(null);
                      setEditing(true);
                    }
                  } else
                    void action(async () => {
                      await flush();
                      // Refuse disconnect before touching credentials when a merge or
                      // an unacknowledged publish still needs the existing connection.
                      await store.configure(null);
                      const result = credentials.save(
                        knowledgeCredentialId(state.sync.target),
                        "",
                        "memory",
                      );
                      setReplacement(null);
                      setScope("memory");
                      setAuto(false);
                      setConfirm(null);
                      setAddress("");
                      setBranch("");
                      setEditing(true);
                      if (result.error) throw new Error(result.error);
                      setMessage("已断开连接，本地笔记仍保留");
                    });
                }}
              >
                {confirm === "clear" ? "确认清除" : "确认断开"}
              </Button>
            </div>
          </div>
        )}
        {!editing && (
          <label className="knowledge-checkbox">
            <input
              type="checkbox"
              checked={auto}
              disabled={!state.sync.target || !token || syncing || busy}
              onChange={(e) => setAuto(e.target.checked)}
            />
            自动同步
          </label>
        )}
      </form>
      {message && <p role="status">{message}</p>}
      {state.sync.target && (
        <p className="knowledge-small">
          {state.sync.lastSyncedAt
            ? `最近同步 ${new Date(state.sync.lastSyncedAt).toLocaleString()}`
            : "尚未同步"}
        </p>
      )}
      {state.sync.pending && (
        <p className="knowledge-small">
          上次提交待核对；下次同步将确认远端结果，保留未完成期间的编辑。
        </p>
      )}
      {state.conflicts.map((conflict) => (
        <article key={`${conflict.kind}:${conflict.key}`} className="knowledge-conflict">
          <h3>
            需要选择保留的内容 ·{" "}
            {conflict.local && "title" in conflict.local
              ? conflict.local.title
              : conflict.remote && "title" in conflict.remote
                ? conflict.remote.title
                : "集合"}
          </h3>
          <div className="knowledge-conflict-versions">
            {(["base", "local", "remote"] as const).map((side) => (
              <div key={side}>
                <h4>{{ base: "共同版本", local: "本机版本", remote: "远端版本" }[side]}</h4>
                <pre>{conflictText(conflict[side])}</pre>
              </div>
            ))}
          </div>
          <div className="knowledge-panel-actions">
            {(["local", "remote", "both"] as const).map((choice) => (
              <Button
                variant="ghost"
                key={choice}
                disabled={busy || syncing}
                onClick={() => void action(() => store.resolve(conflict, choice))}
              >
                {{ local: "保留本机版本", remote: "采用远端版本", both: "保留双方" }[choice]}
              </Button>
            ))}
          </div>
        </article>
      ))}
    </section>
  );
}
function conflictText(value: KnowledgeConflict["base"]) {
  if (!value) return "（已删除 / 尚未创建）";
  return "body" in value
    ? `${value.title}\n标签：${value.tags.join(", ")}\n集合：${value.collectionId ?? "未归类"}\n\n${value.body}\n\n引用：${JSON.stringify(value.citations, null, 2)}`
    : value.name;
}
