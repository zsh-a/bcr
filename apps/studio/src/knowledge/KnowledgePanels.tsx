import { useState } from "react";
import { GitBranch } from "lucide-react";
import {
  CredentialScopeField,
  SecretField,
  ConnectionSummary,
  useAgentHost,
  useCredential,
} from "@bcr/react";
import { knowledgeCredentialId } from "./credential";
import {
  decodeTarget,
  type KnowledgeState,
  type KnowledgeNote,
  type KnowledgeConflict,
} from "./model";
import type { KnowledgeStore } from "./store";
import { GitHubKnowledge } from "./github";

export function KnowledgeSyncPanel({
  state,
  store,
  token,
  auto,
  setAuto,
  syncing,
  onError,
}: {
  state: KnowledgeState;
  store: KnowledgeStore;
  token: string;
  auto: boolean;
  setAuto(value: boolean): void;
  syncing: boolean;
  onError(value: string): void;
}) {
  const { credentials } = useAgentHost();
  const credential = useCredential(knowledgeCredentialId(state.sync.target));
  const [replacement, setReplacement] = useState<string | null>(null);
  const [editing, setEditing] = useState(!state.sync.target || !token);
  const [confirm, setConfirm] = useState<"clear" | "disconnect" | null>(null);
  const [scope, setScope] = useState(credential.scope);
  const [owner, setOwner] = useState(state.sync.target?.owner ?? ""),
    [repo, setRepo] = useState(state.sync.target?.repo ?? ""),
    [branch, setBranch] = useState(state.sync.target?.branch ?? "main");
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const sameTarget =
    knowledgeCredentialId({ owner, repo }) === knowledgeCredentialId(state.sync.target);
  const draftToken = replacement ?? (sameTarget ? token : "");
  const dirty =
    owner !== (state.sync.target?.owner ?? "") ||
    repo !== (state.sync.target?.repo ?? "") ||
    branch !== (state.sync.target?.branch ?? "main") ||
    draftToken !== token ||
    scope !== credential.scope;
  function reset() {
    setOwner(state.sync.target?.owner ?? "");
    setRepo(state.sync.target?.repo ?? "");
    setBranch(state.sync.target?.branch ?? "main");
    setReplacement(null);
    setScope(credential.scope);
    setMessage("");
    setConfirm(null);
    onError("");
  }
  async function action(fn: () => Promise<void>) {
    setBusy(true);
    setMessage("");
    onError("");
    try {
      await fn();
    } catch (error) {
      onError(String(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="knowledge-panel" aria-label="GitHub 同步设置" aria-busy={busy}>
      <header>
        <GitBranch size={18} />
        <h2>连接你的私有知识仓库</h2>
      </header>
      <p>
        选择已添加 README 的私有仓库与已有分支。同步范围为 knowledge/ 下的笔记、集合和引用快照。
      </p>
      {!editing && state.sync.target && (
        <ConnectionSummary
          title={`${state.sync.target.owner}/${state.sync.target.repo}`}
          detail={`分支 · ${state.sync.target.branch}`}
          status={token ? "Token 已配置" : "需要补充 Token"}
        >
          <button
            type="button"
            className="knowledge-button"
            onClick={() => {
              reset();
              setEditing(true);
            }}
          >
            编辑连接
          </button>
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
            setAuto(false);
            const target = decodeTarget({ owner, repo, branch });
            const previousId = knowledgeCredentialId(state.sync.target),
              nextId = knowledgeCredentialId(target);
            if (previousId !== nextId && state.sync.target) {
              const removed = credentials.save(previousId, "", "memory");
              if (removed.error) throw new Error(removed.error);
            }
            await store.configure(target);
            const result = credentials.save(nextId, draftToken, scope);
            if (result.error) throw new Error(result.error);
            setReplacement(null);
            setEditing(false);
            setMessage("连接已保存。点击「立即同步」开始；首次连接会合并本地与远端笔记。");
          });
        }}
      >
        {editing && (
          <fieldset
            disabled={busy || syncing}
            style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}
          >
            <div className="knowledge-connection-fields">
              <label>
                用户或组织
                <input
                  aria-label="GitHub 用户或组织"
                  autoComplete="off"
                  value={owner}
                  onChange={(e) => {
                    setOwner(e.target.value);
                    if (e.target.value.trim().toLowerCase() !== owner.trim().toLowerCase()) {
                      setReplacement(null);
                      setScope("memory");
                    }
                  }}
                  required
                />
              </label>
              <label>
                私有仓库
                <input
                  aria-label="GitHub 私有仓库"
                  autoComplete="off"
                  value={repo}
                  onChange={(e) => {
                    setRepo(e.target.value);
                    if (e.target.value.trim().toLowerCase() !== repo.trim().toLowerCase()) {
                      setReplacement(null);
                      setScope("memory");
                    }
                  }}
                  required
                />
              </label>
              <label>
                分支
                <input
                  aria-label="GitHub 分支"
                  autoComplete="off"
                  value={branch}
                  onChange={(e) => setBranch(e.target.value)}
                  required
                />
              </label>
            </div>
            <SecretField
              key={knowledgeCredentialId({ owner, repo })}
              label="GitHub Token"
              saved={sameTarget && !!token}
              value={replacement}
              onChange={(value) => {
                setReplacement(value);
                setMessage("");
              }}
              placeholder="仅授权该仓库的 Contents 读写权限"
            />
            <CredentialScopeField
              label="GitHub Token 保存范围"
              value={scope}
              onChange={setScope}
              disabled={!draftToken}
            />
            {credential.error && <p role="alert">{credential.error}</p>}
            <p className="knowledge-small">
              修改后请保存连接。更换仓库会清空
              Token；建议只授权该仓库。已打开的其他标签页可能仍保留内存凭据。
            </p>
            <div className="knowledge-panel-actions">
              <button
                type="button"
                className="knowledge-button"
                onClick={() => {
                  reset();
                  if (state.sync.target) setEditing(false);
                }}
              >
                取消
              </button>
              <button
                type="submit"
                className="knowledge-button"
                disabled={busy || syncing || (!dirty && !!token)}
              >
                {busy ? "保存中…" : "保存连接"}
              </button>
            </div>
          </fieldset>
        )}
        {!editing && (
          <details className="bcr-connection-manage">
            <summary>管理连接</summary>
            <div className="knowledge-panel-actions">
              <button
                type="button"
                className="knowledge-button"
                disabled={busy || syncing}
                onClick={() => setConfirm("clear")}
              >
                清除 Token
              </button>
              {state.sync.target && (
                <button
                  type="button"
                  className="knowledge-button"
                  disabled={busy || syncing}
                  onClick={() => setConfirm("disconnect")}
                >
                  断开连接
                </button>
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
              <button
                type="button"
                className="knowledge-button"
                disabled={busy || syncing}
                onClick={() => setConfirm(null)}
              >
                继续保留
              </button>
              <button
                type="button"
                className="knowledge-button"
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
                    }
                  } else
                    void action(async () => {
                      const result = credentials.save(
                        knowledgeCredentialId(state.sync.target),
                        "",
                        "memory",
                      );
                      setReplacement(null);
                      setScope("memory");
                      if (result.error) throw new Error(result.error);
                      await store.configure(null);
                      setAuto(false);
                      setConfirm(null);
                      setOwner("");
                      setRepo("");
                      setBranch("main");
                      setEditing(true);
                      setMessage("已断开连接，本地笔记仍保留");
                    });
                }}
              >
                {confirm === "clear" ? "确认清除" : "确认断开"}
              </button>
            </div>
          </div>
        )}
        <label className="knowledge-checkbox">
          <input
            type="checkbox"
            checked={auto}
            disabled={!state.sync.target || !token || syncing}
            onChange={(e) => setAuto(e.target.checked)}
          />
          本次会话自动同步
        </label>
      </form>
      {message && <p role="status">{message}</p>}
      {state.sync.target && (
        <p className="knowledge-small">
          当前连接：{state.sync.target.owner}/{state.sync.target.repo} · {state.sync.target.branch}
          {state.sync.lastSyncedAt
            ? ` · 最近同步 ${new Date(state.sync.lastSyncedAt).toLocaleString()}`
            : " · 尚未同步"}
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
              <button
                type="button"
                key={choice}
                className="knowledge-button"
                disabled={busy || syncing}
                onClick={() => void action(() => store.resolve(conflict, choice))}
              >
                {{ local: "保留本机版本", remote: "采用远端版本", both: "保留双方" }[choice]}
              </button>
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
export function KnowledgeHistory({
  state,
  note,
  token,
  onRestore,
  onError,
}: {
  state: KnowledgeState;
  note: KnowledgeNote | null;
  token: string;
  onRestore(note: KnowledgeNote): Promise<void>;
  onError(value: string): void;
}) {
  const [all, setAll] = useState(false),
    [busy, setBusy] = useState(false);
  const [remote, setRemote] = useState<{
    id: string;
    entries: { sha: string; message: string; date: string }[];
  } | null>(null);
  const [preview, setPreview] = useState<KnowledgeNote | null>(null);
  async function action(fn: () => Promise<void>) {
    setBusy(true);
    try {
      await fn();
    } catch (error) {
      onError(String(error));
    } finally {
      setBusy(false);
    }
  }
  const revisions = state.history.filter((h) => all || !note || h.note.id === note.id);
  return (
    <section className="knowledge-panel" aria-label="笔记版本历史" aria-busy={busy}>
      <header>
        <h2>版本与恢复</h2>
      </header>
      <p>本机保留最近 100 个修改前版本，包含删除记录。恢复会生成当前修改，下次同步时提交。</p>
      <div className="knowledge-panel-actions">
        <label className="knowledge-checkbox">
          <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} />
          显示全部笔记与删除记录
        </label>
        {note && state.sync.target && (
          <button
            type="button"
            className="knowledge-button"
            disabled={busy || !token}
            onClick={() =>
              void action(async () => {
                setRemote({
                  id: note.id,
                  entries: await new GitHubKnowledge(state.sync.target!, token).history(note.id),
                });
              })
            }
          >
            读取 GitHub 历史
          </button>
        )}
      </div>
      <div className="knowledge-history-list">
        {revisions.map((h) => (
          <button type="button" key={h.id} onClick={() => setPreview(h.note)}>
            <span>{h.note.title || "未命名笔记"}</span>
            <small>
              {h.reason} · {new Date(h.at).toLocaleString()}
            </small>
          </button>
        ))}
        {!revisions.length && <p>还没有历史版本。编辑或删除笔记后会出现在这里。</p>}
        {remote?.id === note?.id &&
          remote?.entries.map((entry) => (
            <button
              type="button"
              key={entry.sha}
              disabled={busy}
              onClick={() =>
                void action(async () =>
                  setPreview(
                    await new GitHubKnowledge(state.sync.target!, token).noteAt(
                      entry.sha,
                      remote.id,
                    ),
                  ),
                )
              }
            >
              <span>GitHub · {entry.message}</span>
              <small>{entry.date}</small>
            </button>
          ))}
      </div>
      {preview && (
        <div className="knowledge-history-preview">
          <h3>{preview.title || "未命名笔记"}</h3>
          <pre>{preview.body}</pre>
          <button
            type="button"
            className="knowledge-button"
            disabled={busy}
            onClick={() => void action(() => onRestore(preview))}
          >
            恢复此版本
          </button>
        </div>
      )}
    </section>
  );
}
