import { contentHash } from "@bcr/core";
import { useRuntime, useRuntimeActivity } from "@bcr/react";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import {
  BookOpenText,
  Download,
  GitBranch,
  History,
  Menu,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { workspaceResearch } from "../researchCapture";
import { assessExcerpt } from "../research";
import { contentOf, emptyContent, newNote, pendingCount } from "./model";
import { workspaceKnowledge } from "./store";
import { FILE_LIMIT, importMarkdown, noteMarkdown } from "./files";
import { GitHubKnowledge } from "./github";
import { syncKnowledge } from "./sync";
import { NoteEditor, type EditorHandle } from "./NoteEditor";
import { KnowledgeSyncPanel, KnowledgeHistory } from "./KnowledgePanels";
import "./knowledge.css";
import { searchKnowledge } from "./retrieval";
import { KnowledgeRestorePanel } from "./KnowledgeRestorePanel";
import { writeKnowledgeBackup } from "./backup";

export function KnowledgeApp() {
  const services = useRuntime(),
    active = useRuntimeActivity(),
    navigate = useNavigate();
  const store = useMemo(() => workspaceKnowledge(services.metadata), [services.metadata]);
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const [ready, setReady] = useState(false),
    [error, setError] = useState("");
  const [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [syncing, setSyncing] = useState(false);
  const [query, setQuery] = useState(""),
    [collection, setCollection] = useState("");
  const [panel, setPanel] = useState<"sync" | "history" | "restore" | null>(null),
    [sidebar, setSidebar] = useState(false);
  const [token, setToken] = useState(""),
    [auto, setAuto] = useState(false);
  const [collectionName, setCollectionName] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const editor = useRef<EditorHandle>(null),
    syncingRef = useRef(false),
    input = useRef<HTMLInputElement>(null);
  const selectedId = useRouterState({
    select: (s) => (s.location.search as { note?: string }).note,
  });
  const notes = Object.values(state.notes).sort(
    (a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id),
  );
  const note =
    (selectedId && Object.hasOwn(state.notes, selectedId) ? state.notes[selectedId] : undefined) ??
    notes[0];
  const filtered = searchKnowledge(notes, query, {
    collectionId: collection,
    limit: notes.length,
  }).hits.map(({ note }) => note);
  const pending = pendingCount(state);
  useEffect(() => {
    let live = true;
    void store.ready.then(
      () => {
        if (live) setReady(true);
      },
      (reason) => {
        if (live) setError(String(reason));
      },
    );
    return () => {
      live = false;
    };
  }, [store]);
  const run = async (action: () => Promise<void>) => {
    if (busy || !ready) return;
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy(false);
    }
  };
  const select = async (id: string) => {
    await editor.current?.flush();
    await navigate({ to: "/knowledge", search: { note: id } });
    setSidebar(false);
    setConfirmDelete(false);
  };
  const create = async () => {
    await editor.current?.flush();
    const created = newNote("", collection || null);
    await store.saveNote(created, null);
    await select(created.id);
  };
  const sync = useCallback(async () => {
    if (!ready || syncingRef.current) return;
    const target = store.getSnapshot().sync.target;
    if (!target || !token.trim()) {
      setPanel("sync");
      setMessage("填写仓库连接与当前会话 Token 后即可同步");
      return;
    }
    syncingRef.current = true;
    setSyncing(true);
    setError("");
    try {
      await editor.current?.flush();
      const result = await syncKnowledge(store, new GitHubKnowledge(target, token));
      setMessage(
        result === "conflicts"
          ? "发现冲突，双方版本已保留"
          : pendingCount(store.getSnapshot())
            ? "本批已同步，新修改等待下一次同步"
            : "已与 GitHub 同步",
      );
      if (result === "conflicts") setPanel("sync");
    } catch (reason) {
      setError(String(reason));
    } finally {
      syncingRef.current = false;
      setSyncing(false);
    }
  }, [store, token, ready]);
  useEffect(() => {
    if (!auto || !token || !state.sync.target || !active) return;
    const trigger = () => {
      if (
        navigator.onLine &&
        document.visibilityState === "visible" &&
        !store.getSnapshot().conflicts.length
      )
        void sync();
    };
    window.addEventListener("online", trigger);
    window.addEventListener("focus", trigger);
    document.addEventListener("visibilitychange", trigger);
    const timer = setInterval(trigger, 30_000);
    trigger();
    return () => {
      clearInterval(timer);
      window.removeEventListener("online", trigger);
      window.removeEventListener("focus", trigger);
      document.removeEventListener("visibilitychange", trigger);
    };
  }, [
    auto,
    token,
    state.sync.target?.owner,
    state.sync.target?.repo,
    state.sync.target?.branch,
    active,
    store,
    sync,
  ]);
  useEffect(() => {
    if (!auto || !token || !state.sync.target || !pending || state.conflicts.length || !active)
      return;
    const timer = setTimeout(() => {
      if (navigator.onLine && document.visibilityState === "visible") void sync();
    }, 3_000);
    return () => clearTimeout(timer);
  }, [
    state.notes,
    state.collections,
    pending,
    auto,
    token,
    active,
    sync,
    state.conflicts.length,
    state.sync.target,
  ]);
  async function importResearch() {
    await editor.current?.flush();
    const research = workspaceResearch(services.metadata);
    await research.ready;
    const content = emptyContent();
    for (const group of research.getSnapshot().collections) {
      const groupId = contentHash(new TextEncoder().encode(`research-collection:${group.id}`));
      content.collections[groupId] = { id: groupId, name: group.name };
      for (const excerpt of group.excerpts) {
        const id = contentHash(
          new TextEncoder().encode(JSON.stringify(["research", group.id, excerpt.id])),
        );
        content.notes[id] = {
          ...newNote(excerpt.title, groupId),
          id,
          body: `${excerpt.text
            .split("\n")
            .map((line) => `> ${line}`)
            .join("\n")}\n\n${excerpt.note}`,
          citations: [excerpt],
        };
      }
    }
    await store.importContent(content);
    setMessage(
      `已导入资料集合中的 ${Object.keys(content.notes).length} 条摘录；已有条目保留原笔记`,
    );
  }
  async function exportAll() {
    await editor.current?.flush();
    download(await writeKnowledgeBackup(contentOf(store.getSnapshot())), "bcr-knowledge.zip");
  }
  if (!ready)
    return (
      <div className="knowledge-loading" role={error ? "alert" : "status"}>
        {error || "正在打开本地知识库…"}
      </div>
    );
  const locked = !!note && state.conflicts.some((c) => c.kind === "note" && c.key === note.id);
  return (
    <div className={`knowledge-app ${sidebar ? "show-sidebar" : ""}`}>
      {sidebar && (
        <button
          type="button"
          className="knowledge-backdrop"
          aria-label="关闭笔记列表"
          onClick={() => setSidebar(false)}
        />
      )}
      <aside className="knowledge-sidebar" aria-label="知识库导航">
        <div className="knowledge-brand">
          <BookOpenText size={22} />
          <div>
            <span>KNOWLEDGE</span>
            <h1>个人知识库</h1>
          </div>
          <button
            type="button"
            className="knowledge-mobile-close"
            aria-label="收起列表"
            onClick={() => setSidebar(false)}
          >
            <X size={18} />
          </button>
        </div>
        <button
          type="button"
          className="knowledge-primary"
          disabled={busy}
          onClick={() => void run(create)}
        >
          <Plus size={17} />
          新建笔记
        </button>
        <label className="knowledge-search">
          <Search size={15} />
          <input
            aria-label="搜索个人笔记"
            placeholder="搜索标题、正文、标签"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <select
          aria-label="筛选笔记集合"
          className="knowledge-select"
          value={collection}
          onChange={(e) => setCollection(e.target.value)}
        >
          <option value="">全部笔记 · {notes.length}</option>
          {Object.values(state.collections).map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <form
          className="knowledge-add-collection"
          onSubmit={(e) => {
            e.preventDefault();
            if (collectionName.trim())
              void run(async () => {
                const id = crypto.randomUUID();
                await store.saveCollection(id, collectionName);
                setCollectionName("");
                setCollection(id);
              });
          }}
        >
          <input
            aria-label="新知识集合名称"
            placeholder="新集合名称"
            maxLength={200}
            value={collectionName}
            onChange={(e) => setCollectionName(e.target.value)}
          />
          <button type="submit" aria-label="创建知识集合" disabled={busy || !collectionName.trim()}>
            <Plus size={15} />
          </button>
        </form>
        <nav className="knowledge-note-list" aria-label="笔记列表">
          {filtered.length ? (
            filtered.map((n) => (
              <button
                type="button"
                key={n.id}
                aria-current={n.id === note?.id ? "page" : undefined}
                className={`knowledge-note-card ${n.id === note?.id ? "selected" : ""}`}
                onClick={() => void run(() => select(n.id))}
              >
                <span>{n.title || "未命名笔记"}</span>
                <p>{n.body.replace(/[#*>`]/gu, "").slice(0, 90) || "等待一个想法…"}</p>
                <small>
                  {new Date(n.updatedAt).toLocaleDateString()}{" "}
                  {n.tags
                    .filter(Boolean)
                    .map((tag) => `#${tag}`)
                    .join(" ")}
                </small>
              </button>
            ))
          ) : (
            <p className="knowledge-list-empty">
              {notes.length ? "没有匹配的笔记" : "留一个地方，给新的想法。"}
            </p>
          )}
        </nav>
        <div className="knowledge-sidebar-bottom">
          <button type="button" onClick={() => input.current?.click()}>
            <Upload size={15} />
            导入 Markdown
          </button>
          <button type="button" disabled={busy} onClick={() => void run(importResearch)}>
            <BookOpenText size={15} />
            从资料集合导入
          </button>
          <button type="button" disabled={busy} onClick={() => void run(exportAll)}>
            <Download size={15} />
            导出知识库
          </button>
          <button
            type="button"
            disabled={busy || syncing}
            onClick={() => {
              setPanel("restore");
              setSidebar(false);
            }}
          >
            <Upload size={15} />
            恢复 ZIP 备份
          </button>
        </div>
        <input
          ref={input}
          type="file"
          accept=".md,.markdown,.txt"
          aria-label="导入 Markdown 笔记"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file)
              void run(async () => {
                if (file.size > FILE_LIMIT) throw new Error("单篇导入上限为 2 MiB");
                const imported = importMarkdown(await file.text(), file.name);
                await editor.current?.flush();
                await store.saveNote(imported, null);
                await select(imported.id);
              });
          }}
        />
      </aside>
      <main className="knowledge-main">
        <header className="knowledge-toolbar">
          <button
            type="button"
            className="knowledge-menu knowledge-button"
            aria-label="打开笔记列表"
            onClick={() => setSidebar(true)}
          >
            <Menu size={18} />
          </button>
          <div className="knowledge-sync-summary">
            <span className={`knowledge-dot ${pending ? "pending" : ""}`} />
            <span>
              {state.conflicts.length
                ? `${state.conflicts.length} 处冲突待处理`
                : !state.sync.target
                  ? "本地知识库"
                  : pending
                    ? `${pending} 项待同步`
                    : "所有笔记已同步"}
            </span>
          </div>
          <div className="knowledge-toolbar-actions">
            <button
              type="button"
              className="knowledge-button"
              aria-label="笔记版本历史"
              aria-pressed={panel === "history"}
              onClick={() => setPanel(panel === "history" ? null : "history")}
            >
              <History size={16} />
              <span>历史</span>
            </button>
            <button
              type="button"
              className="knowledge-button"
              aria-label="GitHub 同步设置"
              aria-pressed={panel === "sync"}
              onClick={() => setPanel(panel === "sync" ? null : "sync")}
            >
              <Settings2 size={16} />
              <span>连接</span>
            </button>
            <button
              type="button"
              className="knowledge-button"
              disabled={syncing || busy}
              onClick={() => void sync()}
            >
              <RefreshCw size={15} className={syncing ? "animate-spin" : ""} />
              {syncing ? "同步中…" : "立即同步"}
            </button>
          </div>
        </header>
        {(message || error) && (
          <div
            role={error ? "alert" : "status"}
            className={`knowledge-notice ${error ? "is-error" : ""}`}
          >
            <span>{error || message}</span>
            <button
              type="button"
              aria-label="关闭提示"
              onClick={() => {
                setError("");
                setMessage("");
              }}
            >
              <X size={15} />
            </button>
          </div>
        )}
        <div className="knowledge-content">
          {panel === "sync" && (
            <KnowledgeSyncPanel
              state={state}
              store={store}
              token={token}
              setToken={setToken}
              auto={auto}
              setAuto={setAuto}
              syncing={syncing}
              onError={setError}
            />
          )}
          {panel === "restore" && (
            <KnowledgeRestorePanel
              store={store}
              flush={async () => {
                await editor.current?.flush();
              }}
              onClose={() => setPanel(null)}
              onRestored={() => {
                setPanel(null);
                setMessage("备份已恢复到本机，未修改同步连接");
              }}
            />
          )}
          {panel === "history" && (
            <KnowledgeHistory
              state={state}
              note={note ?? null}
              token={token}
              onRestore={(n) =>
                run(async () => {
                  await editor.current?.flush();
                  await store.restore(n);
                  await select(n.id);
                  setMessage("已恢复为当前笔记，旧版本仍保留在历史中");
                })
              }
              onError={setError}
            />
          )}
          {note ? (
            <>
              {locked && (
                <div role="alert" className="knowledge-alert">
                  这篇笔记存在同步冲突，双方内容已保留。
                  <button type="button" onClick={() => setPanel("sync")}>
                    处理冲突
                  </button>
                </div>
              )}
              <NoteEditor
                key={note.id}
                note={note}
                store={store}
                collections={Object.values(state.collections)}
                locked={locked}
                editorRef={editor}
              />
              {note.citations.length > 0 && (
                <section className="knowledge-citations">
                  <h2>
                    来源与引用 <span>{note.citations.length}</span>
                  </h2>
                  <p>引用快照随笔记同步。回到原文需要当前设备已有对应资料。</p>
                  {note.citations.map((citation, index) => {
                    const status = assessExcerpt(citation, services.search);
                    return (
                      <details key={`${citation.id}:${index}`}>
                        <summary>
                          {citation.title} <span>{status.label}</span>
                        </summary>
                        <blockquote>{citation.text}</blockquote>
                        <a href={status.route}>回到原文 ↗</a>
                      </details>
                    );
                  })}
                </section>
              )}
              <div className="knowledge-note-actions">
                <button
                  type="button"
                  className="knowledge-button"
                  onClick={() =>
                    void run(async () => {
                      await editor.current?.flush();
                      const saved = store.getSnapshot().notes[note.id]!;
                      download(
                        new Blob([noteMarkdown(saved)], { type: "text/markdown;charset=utf-8" }),
                        `${note.id}.md`,
                      );
                    })
                  }
                >
                  <Download size={14} />
                  导出这篇笔记
                </button>
                {confirmDelete ? (
                  <>
                    <span>删除后可从历史恢复。</span>
                    <button
                      type="button"
                      className="knowledge-button danger"
                      disabled={busy || locked}
                      onClick={() =>
                        void run(async () => {
                          await editor.current?.flush();
                          await store.deleteNote(note.id);
                          await navigate({ to: "/knowledge", search: {} });
                          setConfirmDelete(false);
                        })
                      }
                    >
                      确认删除笔记
                    </button>
                    <button
                      type="button"
                      className="knowledge-button"
                      onClick={() => setConfirmDelete(false)}
                    >
                      取消
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    className="knowledge-button"
                    disabled={locked}
                    onClick={() => setConfirmDelete(true)}
                  >
                    <Trash2 size={14} />
                    删除
                  </button>
                )}
              </div>
            </>
          ) : (
            <section className="knowledge-empty">
              <span className="knowledge-eyebrow">A SPACE FOR YOUR THINKING</span>
              <h2>
                把想法写下来，
                <br />
                让知识慢慢生长。
              </h2>
              <p>
                从一篇手写笔记开始，也可以带入已有资料。
                <br />
                内容保存在本机，连接私有仓库后在设备间同步。
              </p>
              <button type="button" className="knowledge-primary" onClick={() => void run(create)}>
                <Plus size={17} />
                写第一篇笔记
              </button>
              <span className="knowledge-empty-foot">
                <GitBranch size={14} />
                开放 Markdown · 本地优先 · 版本可恢复
              </span>
            </section>
          )}
        </div>
      </main>
    </div>
  );
}
function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob),
    link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 5_000);
}
