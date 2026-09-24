import { useRuntime, useRuntimeActivity, useCredential } from "@bcr/react";
import { knowledgeCredentialId } from "./credential";
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
  Star,
  CalendarDays,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { workspaceServices } from "../workspace";
import { assessExcerpt } from "../research/index";
import { pendingCount } from "./model";
import { noteMarkdown } from "./files";
import { createKnowledgeActions } from "./actions";
import { useKnowledgeSync } from "./useKnowledgeSync";
import { NoteEditor, type EditorHandle } from "./NoteEditor";
import { KnowledgeSyncPanel, KnowledgeHistory } from "./KnowledgePanels";
import "./knowledge.css";
import "./workbench.css";
import { searchKnowledge, noteSearchHit } from "./retrieval";
import { KnowledgeRestorePanel } from "./KnowledgeRestorePanel";
import { EditorSessions } from "./editorSessions";
import { KnowledgeLinkIndex, resolveNoteLink, splitNoteTarget } from "./markdownAnalysis";
import { useWorkbench } from "./useWorkbench";
import { toggleFavorite } from "./workbench";
import { NoteTabs } from "./NoteTabs";
import { NoteSwitcher } from "./NoteSwitcher";
import { KnowledgeDialog } from "./KnowledgeDialog";
import { NoteFileTree } from "./NoteFileTree";
import { NoteMove, type MoveTarget } from "./NoteMove";
import { notePath } from "./paths";
import "./paths.css";

export function KnowledgeApp() {
  const services = useRuntime(),
    active = useRuntimeActivity(),
    navigate = useNavigate();
  const store = useMemo(() => workspaceServices(services.metadata).knowledge, [services.metadata]);
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const [ready, setReady] = useState(false),
    [error, setError] = useState("");
  const [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  const [query, setQuery] = useState(""),
    [collection, setCollection] = useState("");
  const [panel, setPanel] = useState<"sync" | "history" | "restore" | null>(null),
    [sidebar, setSidebar] = useState(false);
  const credential = useCredential(knowledgeCredentialId(state.sync.target));
  const token = credential.value;
  const [auto, setAuto] = useState(false);
  const [collectionName, setCollectionName] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [fileView, setFileView] = useState(false);
  const [moveTarget, setMoveTarget] = useState<MoveTarget | null>(null);
  const [sessions] = useState(() => new EditorSessions());
  const [linkIndex] = useState(() => new KnowledgeLinkIndex());
  const [view, setView] = useState<"all" | "favorites" | "recent">("all");
  const [switcher, setSwitcher] = useState<{ query: string; heading?: string } | null>(null);
  const [target, setTarget] = useState<{
    id: string;
    heading?: string;
    offset?: number;
    sequence: number;
  } | null>(null);
  const [navigation, setNavigation] = useState<{ ids: string[]; index: number }>({
    ids: [],
    index: -1,
  });
  const editor = useRef<EditorHandle>(null),
    input = useRef<HTMLInputElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const scrollPositions = useRef(new Map<string, number>());
  const selectedId = useRouterState({
    select: (s) => (s.location.search as { note?: string }).note,
  });
  const notes = Object.values(state.notes).sort(
    (a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id),
  );
  const note =
    (selectedId && Object.hasOwn(state.notes, selectedId) ? state.notes[selectedId] : undefined) ??
    notes[0];
  const workbench = useWorkbench(ready ? note?.id : undefined);
  useLayoutEffect(() => {
    if (note && content.current)
      content.current.scrollTop = scrollPositions.current.get(note.id) ?? 0;
  }, [note?.id]);
  useEffect(() => {
    if (!ready || !note) return;
    setNavigation((current) =>
      current.ids[current.index] === note.id
        ? current
        : {
            ids: [...current.ids.slice(0, current.index + 1), note.id].slice(-100),
            index: Math.min(current.index + 1, 99),
          },
    );
  }, [ready, note?.id]);
  useEffect(() => {
    if (!active || !ready) return;
    const key = (event: KeyboardEvent) => {
      if (
        (event.ctrlKey || event.metaKey) &&
        event.key.toLowerCase() === "o" &&
        !document.querySelector("dialog[open]") &&
        !(event.target instanceof Element && event.target.closest(".assistant-window"))
      ) {
        event.preventDefault();
        setSwitcher({ query: "" });
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [active, ready]);
  const backlinks = useMemo(() => {
    const all = Object.values(state.notes);
    linkIndex.update(all);
    return note ? linkIndex.backlinks(all, note.id) : [];
  }, [state.notes, note?.id, linkIndex]);
  const listed =
    view === "favorites"
      ? notes.filter((n) => workbench.state.favorites.includes(n.id))
      : view === "recent"
        ? workbench.state.recent.flatMap((id) =>
            Object.hasOwn(state.notes, id) ? [state.notes[id]!] : [],
          )
        : notes;
  const filtered = searchKnowledge(listed, query, {
    collectionId: collection,
    limit: notes.length,
  }).hits.map(({ note }) => note);
  if (view === "recent" && !query.trim())
    filtered.sort(
      (a, b) => workbench.state.recent.indexOf(a.id) - workbench.state.recent.indexOf(b.id),
    );
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
  const flushEditor = useCallback(async () => {
    await editor.current?.flush();
  }, []);
  const actions = useMemo(
    () => createKnowledgeActions(store, workspaceServices(services.metadata).research, flushEditor),
    [store, services.metadata, flushEditor],
  );
  const create = async () => {
    await select(await actions.create(collection || null));
  };
  async function openLink(value: string) {
    await flushEditor();
    const matches = resolveNoteLink(Object.values(store.getSnapshot().notes), value, note?.id);
    const { name, heading } = splitNoteTarget(value);
    if (matches.length === 1) {
      await select(matches[0]!.id);
      setTarget((old) => ({ id: matches[0]!.id, heading, sequence: (old?.sequence ?? 0) + 1 }));
    } else {
      setSwitcher({ query: name, heading });
    }
  }
  async function navigateHistory(direction: -1 | 1) {
    const index = navigation.index + direction,
      id = navigation.ids[index];
    if (!id) return;
    if (!Object.hasOwn(state.notes, id)) throw new Error("这篇笔记已删除，可从历史恢复。");
    await flushEditor();
    setNavigation((current) => ({ ...current, index }));
    await select(id);
  }
  const { sync, syncing } = useKnowledgeSync({
    store,
    ready,
    token,
    auto,
    active,
    flush: flushEditor,
    setError,
    setMessage,
    setPanel,
  });
  async function importResearch() {
    const count = await actions.importResearch();
    setMessage(`已导入资料集合中的 ${count} 条摘录；已有条目保留原笔记`);
  }
  async function exportAll() {
    download(await actions.exportBackup(), "bcr-knowledge.zip");
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
      {switcher && (
        <NoteSwitcher
          notes={notes}
          initialQuery={switcher.query}
          onClose={() => setSwitcher(null)}
          onSelect={async (id) => {
            await select(id);
            const hit = noteSearchHit(store.getSnapshot().notes[id]!, switcher.query);
            setTarget((old) => ({
              id,
              heading: switcher.heading ?? "",
              offset: hit.match?.start ?? 0,
              sequence: (old?.sequence ?? 0) + 1,
            }));
          }}
          onCreate={async (title) => {
            await select(await actions.create(collection || null, title));
          }}
        />
      )}
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
        <div className="knowledge-shortcuts">
          <button
            type="button"
            aria-label="快速切换笔记"
            onClick={() => setSwitcher({ query: "" })}
          >
            <Search size={15} />
            <span>快速打开</span>
            <kbd>⌘/Ctrl O</kbd>
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await select(await actions.daily());
              })
            }
          >
            <CalendarDays size={15} />
            <span>今日日记</span>
          </button>
        </div>
        <div className="knowledge-library-views" aria-label="笔记范围">
          {(
            [
              ["all", "全部"],
              ["favorites", "收藏"],
              ["recent", "最近"],
            ] as const
          ).map(([id, title]) => (
            <button type="button" key={id} aria-pressed={view === id} onClick={() => setView(id)}>
              {title}
            </button>
          ))}
        </div>
        <label className="knowledge-search">
          <Search size={15} />
          <input
            aria-label="搜索个人笔记"
            placeholder="搜索标题、路径、正文、标签"
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
        <details className="knowledge-collection-create">
          <summary>新建集合</summary>
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
            <button
              type="submit"
              aria-label="创建知识集合"
              disabled={busy || !collectionName.trim()}
            >
              <Plus size={15} />
            </button>
          </form>
        </details>
        <div className="knowledge-library-views" aria-label="笔记导航方式">
          <button type="button" aria-pressed={!fileView} onClick={() => setFileView(false)}>
            列表
          </button>
          <button type="button" aria-pressed={fileView} onClick={() => setFileView(true)}>
            文件夹
          </button>
        </div>
        <nav className="knowledge-note-list" aria-label="笔记列表">
          {filtered.length && fileView ? (
            <NoteFileTree
              notes={filtered}
              activeId={note?.id}
              onSelect={(id) => void run(() => select(id))}
              onMoveFolder={(folder) => setMoveTarget({ folder })}
            />
          ) : filtered.length ? (
            filtered.map((n) => (
              <button
                type="button"
                key={n.id}
                aria-current={n.id === note?.id ? "page" : undefined}
                className={`knowledge-note-card ${n.id === note?.id ? "selected" : ""}`}
                onClick={() =>
                  void run(async () => {
                    await select(n.id);
                    if (query.trim())
                      setTarget((old) => ({
                        id: n.id,
                        offset: noteSearchHit(n, query).match?.start ?? 0,
                        sequence: (old?.sequence ?? 0) + 1,
                      }));
                  })
                }
              >
                <span>{n.title || "未命名笔记"}</span>
                <p>
                  {(query.trim() ? noteSearchHit(n, query).preview : n.body)
                    .replace(/[#*>`]/gu, "")
                    .slice(0, 140) || "等待一个想法…"}
                </p>
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
        <details className="knowledge-sidebar-bottom">
          <summary>导入、导出与备份</summary>
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
        </details>
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
                await select(await actions.importMarkdown(file));
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
            {note && (
              <button
                type="button"
                className="knowledge-button"
                aria-label="收藏当前笔记"
                aria-pressed={workbench.state.favorites.includes(note.id)}
                onClick={() => workbench.setState((current) => toggleFavorite(current, note.id))}
              >
                <Star
                  size={16}
                  fill={workbench.state.favorites.includes(note.id) ? "currentColor" : "none"}
                />
              </button>
            )}
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
        {note && (
          <div className="knowledge-pathbar" aria-label="笔记位置">
            <span>{notePath(note)}</span>
            <button
              type="button"
              className="knowledge-button"
              onClick={() => setMoveTarget({ noteId: note.id })}
            >
              移动笔记
            </button>
          </div>
        )}
        {moveTarget && (
          <NoteMove
            target={moveTarget}
            store={store}
            flush={flushEditor}
            onClose={() => setMoveTarget(null)}
          />
        )}
        <NoteTabs
          notes={state.notes}
          ids={workbench.state.tabs}
          activeId={note?.id}
          history={{
            back: navigation.index > 0,
            forward: navigation.index + 1 < navigation.ids.length,
          }}
          onHistory={(direction) => void run(() => navigateHistory(direction))}
          onSelect={(id) => void run(() => select(id))}
          onClose={(id) =>
            void run(async () => {
              await flushEditor();
              const remaining = workbench.state.tabs.filter(
                (item) => item !== id && Object.hasOwn(state.notes, item),
              );
              if (id === note?.id && remaining.length) await select(remaining.at(-1)!);
              workbench.setState((current) => ({
                ...current,
                tabs: current.tabs.filter((item) => item !== id),
              }));
              sessions.delete(id);
            })
          }
        />
        {workbench.error && (
          <p role="status" className="knowledge-alert">
            {workbench.error}
          </p>
        )}
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
        <div
          className="knowledge-content"
          ref={content}
          onScroll={(event) => {
            if (!note) return;
            scrollPositions.current.set(note.id, event.currentTarget.scrollTop);
            if (scrollPositions.current.size > 100)
              scrollPositions.current.delete(scrollPositions.current.keys().next().value!);
          }}
        >
          <KnowledgeDialog
            open={active && panel === "sync"}
            title="连接设置"
            onClose={() => setPanel(null)}
            error={error}
          >
            <KnowledgeSyncPanel
              state={state}
              store={store}
              token={token}
              auto={auto}
              setAuto={setAuto}
              syncing={syncing}
              onError={setError}
            />
          </KnowledgeDialog>
          <KnowledgeDialog
            open={active && panel === "restore"}
            title="恢复备份"
            onClose={() => setPanel(null)}
          >
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
          </KnowledgeDialog>
          <KnowledgeDialog
            open={active && panel === "history"}
            title="版本历史"
            onClose={() => setPanel(null)}
            error={error}
          >
            <KnowledgeHistory
              key={note?.id ?? "all"}
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
          </KnowledgeDialog>
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
                sessions={sessions}
                notes={notes}
                backlinks={backlinks}
                onOpenLink={(value) => void run(() => openLink(value))}
                target={target}
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
