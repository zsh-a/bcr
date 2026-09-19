import { useState } from "react";
import { GitBranch } from "lucide-react";
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
  setToken,
  auto,
  setAuto,
  syncing,
  onError,
}: {
  state: KnowledgeState;
  store: KnowledgeStore;
  token: string;
  setToken(value: string): void;
  auto: boolean;
  setAuto(value: boolean): void;
  syncing: boolean;
  onError(value: string): void;
}) {
  const [owner, setOwner] = useState(state.sync.target?.owner ?? ""),
    [repo, setRepo] = useState(state.sync.target?.repo ?? ""),
    [branch, setBranch] = useState(state.sync.target?.branch ?? "main");
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  async function action(fn: () => Promise<void>) {
    setBusy(true);
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
    <section className="knowledge-panel" aria-label="GitHub 同步设置">
      <header>
        <GitBranch size={18} />
        <h2>连接你的私有知识仓库</h2>
      </header>
      <p>
        选择已添加 README 的私有仓库与已有分支。同步范围为 knowledge/ 下的笔记、集合和引用快照。
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void action(async () => {
            setAuto(false);
            await store.configure(decodeTarget({ owner, repo, branch }));
            setMessage("连接已保存。点击「立即同步」开始；首次连接会合并本地与远端笔记。");
          });
        }}
      >
        <div className="knowledge-connection-fields">
          <label>
            用户或组织
            <input
              aria-label="GitHub 用户或组织"
              autoComplete="off"
              value={owner}
              onChange={(e) => setOwner(e.target.value)}
              required
            />
          </label>
          <label>
            私有仓库
            <input
              aria-label="GitHub 私有仓库"
              autoComplete="off"
              value={repo}
              onChange={(e) => setRepo(e.target.value)}
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
        <label className="knowledge-token">
          当前会话 Token
          <input
            aria-label="GitHub Token"
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="仅授权该仓库的 Contents 读写权限"
          />
        </label>
        <p className="knowledge-small">
          Token 仅驻留当前页面内存，刷新后需重新填写。仓库应只授权给你信任的人。
        </p>
        <div className="knowledge-panel-actions">
          <button type="submit" className="knowledge-button" disabled={busy || syncing}>
            保存连接
          </button>
          {state.sync.target && (
            <button
              type="button"
              className="knowledge-button"
              disabled={busy || syncing}
              onClick={() =>
                void action(async () => {
                  await store.configure(null);
                  setToken("");
                  setAuto(false);
                  setMessage("已断开连接，本地笔记仍保留");
                })
              }
            >
              断开连接
            </button>
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
        </div>
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
    <section className="knowledge-panel" aria-label="笔记版本历史">
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
