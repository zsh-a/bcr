import { useState } from "react";
import { Button } from "@bcr/react";
import type { KnowledgeState, KnowledgeNote } from "./model";
import { GitHubKnowledge } from "./github";
import { DiffView } from "./diffView";
import { relativeTime } from "./syncPopover";

function summary(body: string): string {
  const line = body
    .split("\n")
    .find((row) => row.trim())
    ?.trim();
  if (!line) return "（无正文）";
  return line.length > 80 ? `${line.slice(0, 80)}…` : line;
}

/** 版本历史：本机 / GitHub 两个页签；每条以相对时间 + 标题摘要呈现，内联渲染差异并可直接恢复。 */
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
  const [tab, setTab] = useState<"local" | "github">("local");
  const [all, setAll] = useState(false),
    [busy, setBusy] = useState(false);
  const [remote, setRemote] = useState<{
    id: string;
    entries: { sha: string; message: string; date: string }[];
  } | null>(null);
  const [loaded, setLoaded] = useState<Record<string, KnowledgeNote>>({});
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
  const currentBody = (id: string) => state.notes[id]?.body ?? "";
  const commitNoteId = remote?.id ?? "";
  const commits = remote && commitNoteId === note?.id ? remote.entries : [];
  return (
    <section
      className="knowledge-panel knowledge-history"
      aria-label="笔记版本历史"
      aria-busy={busy}
    >
      <div className="knowledge-history-tabs" role="tablist" aria-label="历史来源">
        <Button
          variant="default"
          role="tab"
          aria-selected={tab === "local"}
          aria-pressed={tab === "local"}
          onClick={() => setTab("local")}
        >
          本机版本
        </Button>
        <Button
          variant="default"
          role="tab"
          aria-selected={tab === "github"}
          aria-pressed={tab === "github"}
          onClick={() => setTab("github")}
        >
          GitHub
        </Button>
      </div>
      {tab === "local" ? (
        <>
          <p className="knowledge-history-quiet">
            本机保留最近 100 个修改前版本，包含删除记录。恢复会生成当前修改，下次同步时提交。
          </p>
          <div className="knowledge-panel-actions">
            <label className="knowledge-checkbox">
              <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} />
              显示全部笔记与删除记录
            </label>
          </div>
          <ul className="knowledge-history-entries">
            {revisions.map((h) => (
              <li key={h.id} className="knowledge-history-entry">
                <div className="knowledge-history-entry-head">
                  <time dateTime={new Date(h.at).toISOString()}>{relativeTime(h.at)}</time>
                  <strong>{h.note.title || "未命名笔记"}</strong>
                  <span className="knowledge-history-entry-summary">{summary(h.note.body)}</span>
                  <span className="knowledge-history-entry-reason">{h.reason}</span>
                  <Button
                    variant="primary"
                    size="sm"
                    disabled={busy}
                    onClick={() => void action(() => onRestore(h.note))}
                  >
                    恢复
                  </Button>
                </div>
                <DiffView
                  before={currentBody(h.note.id)}
                  after={h.note.body}
                  beforeLabel="当前版本"
                  afterLabel="此版本"
                />
              </li>
            ))}
          </ul>
          {!revisions.length && <p>还没有历史版本。编辑或删除笔记后会出现在这里。</p>}
        </>
      ) : (
        <>
          <p className="knowledge-history-quiet">
            读取当前笔记在 GitHub 上的提交记录；恢复会生成本机修改，下次同步时提交。
          </p>
          {note && state.sync.target && (
            <div className="knowledge-panel-actions">
              <Button
                variant="ghost"
                disabled={busy || !token}
                onClick={() =>
                  void action(async () => {
                    setRemote({
                      id: note.id,
                      entries: await new GitHubKnowledge(state.sync.target!, token).history(
                        note.id,
                      ),
                    });
                  })
                }
              >
                读取 GitHub 历史
              </Button>
            </div>
          )}
          {!note && <p>打开一篇笔记后可查看它的 GitHub 历史。</p>}
          {note && !state.sync.target && <p>连接 GitHub 后可查看远端历史。</p>}
          <ul className="knowledge-history-entries">
            {commits.map((entry) => (
              <li key={entry.sha} className="knowledge-history-entry">
                <div className="knowledge-history-entry-head">
                  <time dateTime={entry.date}>
                    {Number.isNaN(Date.parse(entry.date))
                      ? entry.date
                      : relativeTime(Date.parse(entry.date))}
                  </time>
                  <strong>{note?.title || "未命名笔记"}</strong>
                  <span className="knowledge-history-entry-summary">{entry.message}</span>
                  <span className="knowledge-history-entry-reason">GitHub</span>
                  <Button
                    variant="primary"
                    size="sm"
                    disabled={busy}
                    onClick={() =>
                      void action(async () =>
                        onRestore(
                          await new GitHubKnowledge(state.sync.target!, token).noteAt(
                            entry.sha,
                            commitNoteId,
                          ),
                        ),
                      )
                    }
                  >
                    恢复
                  </Button>
                  <Button
                    variant="default"
                    size="sm"
                    disabled={busy}
                    onClick={() =>
                      void action(async () => {
                        const saved = await new GitHubKnowledge(state.sync.target!, token).noteAt(
                          entry.sha,
                          commitNoteId,
                        );
                        setLoaded({ ...loaded, [entry.sha]: saved });
                      })
                    }
                  >
                    {loaded[entry.sha] ? "刷新改动" : "查看改动"}
                  </Button>
                </div>
                {loaded[entry.sha] && (
                  <DiffView
                    before={currentBody(commitNoteId)}
                    after={loaded[entry.sha]!.body}
                    beforeLabel="当前版本"
                    afterLabel="此版本"
                  />
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
