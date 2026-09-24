import { useState } from "react";
import { Button } from "@bcr/react";
import type { KnowledgeState, KnowledgeNote } from "./model";
import { GitHubKnowledge } from "./github";

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
  onRestore: (note: KnowledgeNote) => Promise<void>;
  onError: (value: string) => void;
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
          <Button
            variant="ghost"
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
          </Button>
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
          <Button
            variant="primary"
            disabled={busy}
            onClick={() => void action(() => onRestore(preview))}
          >
            恢复此版本
          </Button>
        </div>
      )}
    </section>
  );
}
