import {
  Button,
  IconButton,
  Select,
  Skeleton,
  useRuntime,
  useRuntimeActivity,
  useCredential,
  useUpdateParticipant,
} from "@bcr/react";
import { knowledgeCredentialId } from "./credential";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import {
  BookOpenText,
  Download,
  Folder,
  History,
  List,
  Menu,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  Star,
  Trash2,
  Upload,
  X,
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
import { useAutoSync } from "./useAutoSync";
import { NoteEditor, type EditorHandle } from "./NoteEditor";
import { KnowledgeSyncPanel } from "./KnowledgeSyncPanel";
import { KnowledgeHistory } from "./KnowledgeHistory";
import { SyncStatus, relativeTime } from "./syncPopover";
import { ConflictList, type ConflictChoice } from "./conflicts";
import "./knowledge.css";
import "./workbench.css";
import { searchKnowledge, noteSearchHit } from "./retrieval";
import { KnowledgeRestorePanel } from "./KnowledgeRestorePanel";
import { EditorSessions } from "./editorSessions";
import { KnowledgeLinkIndex, resolveNoteLink, splitNoteTarget } from "./markdownAnalysis";
import { useWorkbench } from "./useWorkbench";
import { closeNote, closeOtherNotes, openNote, toggleFavorite, togglePinned } from "./workbench";
import { KnowledgeStore } from "./store";
import { NoteTabs } from "./NoteTabs";
import { NoteActionsMenu } from "./NoteActionsMenu";
import { NoteSwitcher, type PaletteAction } from "./NoteSwitcher";
import { KnowledgeDialog } from "./KnowledgeDialog";
import { NoteFileTree } from "./NoteFileTree";
import { NoteMove, type MoveTarget } from "./NoteMove";
import "./paths.css";

const VIEW_DEFS = [
  ["all", "全部"],
  ["favorites", "收藏"],
  ["recent", "最近"],
] as const;

export function KnowledgeApp() {
  const services = useRuntime(),
    active = useRuntimeActivity(),
    navigate = useNavigate();
  const [bootAttempt, setBootAttempt] = useState(0);
  // 启动失败后重试会换一个全新的存储会话重新载入；首个会话仍走共享组合根。
  const store = useMemo(
    () =>
      bootAttempt === 0
        ? workspaceServices(services.metadata).knowledge
        : new KnowledgeStore(services.metadata),
    [services.metadata, bootAttempt],
  );
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const [ready, setReady] = useState(false),
    [error, setError] = useState("");
  const [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  useUpdateParticipant({
    blocked: () =>
      !ready || busy || store.syncing ? "知识库正在加载、保存或同步，请完成后再更新。" : null,
    save: () => store.flush(),
  });
  const [query, setQuery] = useState(""),
    [collection, setCollection] = useState("");
  const [panel, setPanel] = useState<"sync" | "history" | "restore" | "conflicts" | null>(null),
    [sidebar, setSidebar] = useState(false);
  const credential = useCredential(knowledgeCredentialId(state.sync.target));
  const token = credential.value;
  const [auto, setAuto] = useAutoSync(state.sync.target, setError);
  const [collectionName, setCollectionName] = useState(""),
    [addingCollection, setAddingCollection] = useState(false);
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
  const editor = useRef<EditorHandle>(null),
    input = useRef<HTMLInputElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const scrollPositions = useRef(new Map<string, number>());
  const selectedId = useRouterState({
    select: (s) => (s.location.search as { note?: string }).note,
  });
  // 关闭最后一个标签后显式回到空状态；直达 /knowledge（无 ?note）仍显示最近笔记。
  const [closedAll, setClosedAll] = useState(false);
  const notes = Object.values(state.notes).sort(
    (a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id),
  );
  const note =
    selectedId && Object.hasOwn(state.notes, selectedId)
      ? state.notes[selectedId]
      : selectedId || closedAll
        ? undefined
        : notes[0];
  const workbench = useWorkbench(ready ? note?.id : undefined);
  useLayoutEffect(() => {
    if (note && content.current)
      content.current.scrollTop = scrollPositions.current.get(note.id) ?? 0;
  }, [note?.id]);
  useEffect(() => {
    let live = true;
    void store.ready.then(
      () => {
        if (live) {
          setError("");
          setReady(true);
        }
      },
      (reason) => {
        if (live) setError(String(reason));
      },
    );
    return () => {
      live = false;
    };
  }, [store]);
  useEffect(() => {
    if (!active || !ready) return;
    const key = (event: KeyboardEvent) => {
      const pressed = event.key.toLowerCase();
      const chord = (event.ctrlKey || event.metaKey) && (pressed === "k" || pressed === "o");
      if (!chord) return;
      if (document.querySelector("dialog.knowledge-switcher[open]")) {
        // 命令面板开着时再按一次收起；不让位给全局面板。
        event.preventDefault();
        event.stopPropagation();
        setSwitcher(null);
        return;
      }
      if (
        !document.querySelector("dialog[open]") &&
        !(event.target instanceof Element && event.target.closest(".assistant-window"))
      ) {
        // 捕获阶段先于外壳的 ⌘K 全局面板：知识库内 ⌘/Ctrl+K 打开笔记命令面板。
        event.preventDefault();
        event.stopPropagation();
        setSwitcher({ query: "" });
      }
    };
    window.addEventListener("keydown", key, { capture: true });
    return () => window.removeEventListener("keydown", key, { capture: true });
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
  // 导航类动作不占全局忙碌位，双击打开标签不会被单击的进行中操作拦下。
  const go = (action: () => Promise<void>) => {
    void action().catch((reason) => setError(String(reason)));
  };
  const select = async (id: string, open = false) => {
    await editor.current?.flush();
    if (open) workbench.setState((current) => openNote(current, id));
    setClosedAll(false);
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
    await select(await actions.create(collection || null), true);
  };
  async function openLink(value: string) {
    await flushEditor();
    const matches = resolveNoteLink(Object.values(store.getSnapshot().notes), value, note?.id);
    const { name, heading } = splitNoteTarget(value);
    if (matches.length === 1) {
      await select(matches[0]!.id, true);
      setTarget((old) => ({ id: matches[0]!.id, heading, sequence: (old?.sequence ?? 0) + 1 }));
    } else {
      setSwitcher({ query: name, heading });
    }
  }
  // 同步钩子只请求“同步”入口；已有冲突时直达冲突面板，不再重复弹设置。
  const openSyncPanel = useCallback(
    (value: "sync") => {
      if (value === "sync" && store.getSnapshot().conflicts.length) setPanel("conflicts");
      else setPanel(value);
    },
    [store],
  );
  const { sync, syncing } = useKnowledgeSync({
    store,
    ready,
    token,
    auto: auto && panel !== "sync",
    active,
    flush: flushEditor,
    setError,
    setMessage,
    setPanel: openSyncPanel,
  });
  async function importResearch() {
    const count = await actions.importResearch();
    setMessage(`已导入资料集合中的 ${count} 条摘录；已有条目保留原笔记`);
  }
  async function exportAll() {
    download(await actions.exportBackup(), "bcr-knowledge.zip");
  }
  async function exportNote() {
    await flushEditor();
    const saved = note ? store.getSnapshot().notes[note.id] : undefined;
    if (saved)
      download(
        new Blob([noteMarkdown(saved)], { type: "text/markdown;charset=utf-8" }),
        `${saved.title || "未命名笔记"}.md`,
      );
  }
  if (!ready)
    return error ? (
      <div className="knowledge-boot" role="alert">
        <p className="knowledge-boot-title">知识库没有打开。</p>
        <p className="knowledge-boot-error">{error}</p>
        <Button
          variant="primary"
          onClick={() => {
            setError("");
            setReady(false);
            setBootAttempt((attempt) => attempt + 1);
          }}
        >
          <RefreshCw size={15} />
          重试
        </Button>
      </div>
    ) : (
      <div
        className="knowledge-app knowledge-boot-shell"
        role="status"
        aria-label="正在打开本地知识库"
      >
        <aside className="knowledge-sidebar">
          <Skeleton className="knowledge-skeleton-sm" />
          <Skeleton />
          <Skeleton />
          <Skeleton />
          <Skeleton className="knowledge-skeleton-fill" />
        </aside>
        <main className="knowledge-main">
          <Skeleton className="knowledge-skeleton-sm" />
          <Skeleton />
          <Skeleton className="knowledge-skeleton-fill" />
        </main>
      </div>
    );
  const locked = !!note && state.conflicts.some((c) => c.kind === "note" && c.key === note.id);
  const favorite = !!note && workbench.state.favorites.includes(note.id);
  const clearFilters = () => {
    setQuery("");
    setCollection("");
    setView("all");
  };
  const paletteActions: PaletteAction[] = [
    {
      id: "new",
      label: "新建笔记",
      hint: `新建到${collection ? `「${state.collections[collection]?.name ?? "所选集合"}」` : "「未归类」"}`,
      run: async () => {
        await run(create);
      },
    },
    {
      id: "daily",
      label: "今日日记",
      hint: "打开或创建今天的日记",
      run: async () => {
        await run(async () => {
          await select(await actions.daily(), true);
        });
      },
    },
    {
      id: "history",
      label: "打开版本历史",
      run: async () => {
        setPanel("history");
        setSidebar(false);
      },
    },
    {
      id: "sync",
      label: "打开同步设置",
      run: async () => {
        setPanel("sync");
        setSidebar(false);
      },
    },
    {
      id: "restore",
      label: "备份与恢复",
      run: async () => {
        setPanel("restore");
        setSidebar(false);
      },
    },
    {
      id: "export-note",
      label: "导出当前笔记",
      disabled: !note,
      run: async () => {
        await run(exportNote);
      },
    },
    {
      id: "move",
      label: "移动当前笔记",
      hint: "更改集合与文件夹",
      disabled: !note,
      run: async () => {
        await flushEditor();
        setMoveTarget({ noteId: note!.id });
      },
    },
    {
      id: "rename",
      label: "重命名当前笔记",
      hint: "在标题处直接编辑",
      disabled: !note,
      run: async () => {
        await flushEditor();
        document.querySelector<HTMLInputElement>(".knowledge-title")?.focus();
      },
    },
    {
      id: "delete",
      label: "删除当前笔记",
      hint: "删除后可从历史恢复",
      disabled: !note || locked,
      run: async () => {
        await flushEditor();
        setConfirmDelete(true);
      },
    },
    {
      id: "import-md",
      label: "导入 Markdown",
      run: async () => {
        input.current?.click();
      },
    },
    {
      id: "import-research",
      label: "从资料集合导入",
      run: async () => {
        await run(importResearch);
      },
    },
    {
      id: "export-all",
      label: "导出知识库",
      run: async () => {
        await run(exportAll);
      },
    },
    {
      id: "close-others",
      label: "关闭其他标签",
      hint: "固定标签保留",
      disabled: !note || workbench.state.tabs.length < 2,
      run: async () => {
        await flushEditor();
        workbench.setState((current) => closeOtherNotes(current, note!.id));
      },
    },
  ];
  return (
    <div className={`knowledge-app ${sidebar ? "show-sidebar" : ""}`}>
      <NoteSwitcher
        open={switcher !== null}
        notes={notes}
        initialQuery={switcher?.query ?? ""}
        onClose={() => setSwitcher(null)}
        onSelect={async (id) => {
          await select(id, true);
          const hit = noteSearchHit(store.getSnapshot().notes[id]!, switcher?.query ?? "");
          setTarget((old) => ({
            id,
            heading: switcher?.heading ?? "",
            offset: hit.match?.start ?? 0,
            sequence: (old?.sequence ?? 0) + 1,
          }));
        }}
        onCreate={async (title) => {
          await select(await actions.create(collection || null, title), true);
        }}
        actions={paletteActions}
      />
      {sidebar && (
        <button
          type="button"
          className="knowledge-backdrop"
          aria-label="关闭笔记列表"
          onClick={() => setSidebar(false)}
        />
      )}
      <aside className="knowledge-sidebar" aria-label="知识库导航">
        <div className="knowledge-sidebar-heading">
          <span>我的笔记</span>
          <IconButton
            label="收起列表"
            className="knowledge-mobile-close"
            onClick={() => setSidebar(false)}
          >
            <X size={18} />
          </IconButton>
          <Button
            className="knowledge-create"
            variant="ghost"
            disabled={busy}
            onClick={() => void run(create)}
          >
            <Plus size={16} />
            新建笔记
          </Button>
        </div>
        <label className="knowledge-search">
          <Search size={15} />
          <input
            aria-label="搜索个人笔记"
            placeholder="搜索笔记"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape" && query) {
                event.preventDefault();
                event.stopPropagation();
                setQuery("");
              }
            }}
          />
          {query && (
            <button
              type="button"
              className="knowledge-search-clear"
              aria-label="清除搜索"
              onClick={(event) => {
                setQuery("");
                event.currentTarget.closest("label")?.querySelector("input")?.focus();
              }}
            >
              <X size={14} />
            </button>
          )}
        </label>
        {/* 视图行：范围=细分段；列表/文件夹=右侧小图标切换（保留导航语义）。 */}
        <div className="knowledge-view-row" aria-label="笔记范围与导航方式">
          <div className="knowledge-segmented" role="group" aria-label="笔记范围">
            {VIEW_DEFS.map(([id, label]) => (
              <button type="button" key={id} aria-pressed={view === id} onClick={() => setView(id)}>
                {label}
              </button>
            ))}
          </div>
          <div className="knowledge-view-mode" role="group" aria-label="导航方式">
            <button
              type="button"
              aria-label="列表视图"
              aria-pressed={!fileView}
              onClick={() => setFileView(false)}
            >
              <List size={14} />
            </button>
            <button
              type="button"
              aria-label="文件夹视图"
              aria-pressed={fileView}
              onClick={() => setFileView(true)}
            >
              <Folder size={14} />
            </button>
          </div>
        </div>
        <div className="knowledge-collection-row">
          <Select
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
          </Select>
          <IconButton
            label="新建集合"
            size="sm"
            aria-expanded={addingCollection}
            onClick={() => setAddingCollection((open) => !open)}
          >
            <Plus size={15} />
          </IconButton>
        </div>
        {addingCollection && (
          <form
            className="knowledge-add-collection"
            onSubmit={(e) => {
              e.preventDefault();
              if (collectionName.trim())
                void run(async () => {
                  const id = crypto.randomUUID();
                  await store.saveCollection(id, collectionName);
                  setCollectionName("");
                  setAddingCollection(false);
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
            <IconButton
              type="submit"
              label="创建知识集合"
              size="sm"
              disabled={busy || !collectionName.trim()}
            >
              <Plus size={15} />
            </IconButton>
          </form>
        )}
        <nav className="knowledge-note-list" aria-label="笔记列表">
          {filtered.length && fileView ? (
            <NoteFileTree
              notes={filtered}
              activeId={note?.id}
              onSelect={(id) => go(() => select(id))}
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
                  go(async () => {
                    await select(n.id);
                    if (query.trim())
                      setTarget((old) => ({
                        id: n.id,
                        offset: noteSearchHit(n, query).match?.start ?? 0,
                        sequence: (old?.sequence ?? 0) + 1,
                      }));
                  })
                }
                onDoubleClick={() => go(() => select(n.id, true))}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                    event.preventDefault();
                    go(() => select(n.id, true));
                  }
                }}
              >
                <span>{n.title || "未命名笔记"}</span>
                <p>
                  {(query.trim() ? noteSearchHit(n, query).preview : n.body)
                    .replace(/[#*>`]/gu, "")
                    .slice(0, 140) || "等待一个想法…"}
                </p>
                <small className="knowledge-note-meta">
                  <time dateTime={new Date(n.updatedAt).toISOString()}>
                    {noteWhen(n.updatedAt)}
                  </time>
                  {n.tags
                    .filter(Boolean)
                    .slice(0, 3)
                    .map((tag) => (
                      <span key={tag} className="knowledge-chip">
                        {tag}
                      </span>
                    ))}
                </small>
              </button>
            ))
          ) : (
            <div className="knowledge-list-empty">
              {notes.length ? (
                <>
                  <p>没有匹配的笔记。</p>
                  <div className="knowledge-list-empty-actions">
                    <Button size="sm" onClick={clearFilters}>
                      清除筛选
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy}
                      onClick={() =>
                        void run(async () => {
                          await select(
                            await actions.create(collection || null, query.trim()),
                            true,
                          );
                        })
                      }
                    >
                      {query.trim() ? `创建「${query.trim().slice(0, 10)}」` : "写第一篇笔记"}
                    </Button>
                  </div>
                </>
              ) : (
                <p>留一个地方，给新的想法。</p>
              )}
            </div>
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
                await select(await actions.importMarkdown(file), true);
              });
          }}
        />
      </aside>
      <main className="knowledge-main">
        <NoteMove
          open={moveTarget !== null}
          target={moveTarget}
          store={store}
          flush={flushEditor}
          onClose={() => setMoveTarget(null)}
        />
        <KnowledgeDialog
          open={confirmDelete && !!note}
          title="删除笔记"
          onClose={() => setConfirmDelete(false)}
          error={error}
        >
          <p>删除「{note?.title || "未命名笔记"}」？之后仍可从版本历史恢复。</p>
          <div className="knowledge-dialog-actions">
            <Button variant="ghost" onClick={() => setConfirmDelete(false)}>
              取消
            </Button>
            <Button
              variant="danger"
              disabled={busy || locked}
              onClick={() =>
                void run(async () => {
                  if (!note) return;
                  await flushEditor();
                  await store.deleteNote(note.id);
                  await navigate({ to: "/knowledge", search: {} });
                  setConfirmDelete(false);
                })
              }
            >
              确认删除笔记
            </Button>
          </div>
        </KnowledgeDialog>
        <NoteTabs
          leading={
            <IconButton
              label="打开笔记列表"
              className="knowledge-menu"
              onClick={() => setSidebar(true)}
            >
              <Menu size={18} />
            </IconButton>
          }
          notes={state.notes}
          ids={workbench.state.tabs}
          pinned={workbench.state.pinned}
          activeId={note?.id}
          actions={
            <>
              {note && (
                <IconButton
                  label="收藏当前笔记"
                  className="knowledge-note-shortcut"
                  title={favorite ? "取消收藏" : "收藏"}
                  size="sm"
                  aria-pressed={favorite}
                  onClick={() => workbench.setState((current) => toggleFavorite(current, note.id))}
                >
                  <Star size={15} fill={favorite ? "currentColor" : "none"} />
                </IconButton>
              )}
              <IconButton
                label="笔记版本历史"
                className="knowledge-note-shortcut"
                title="笔记版本历史"
                size="sm"
                onClick={() => setPanel(panel === "history" ? null : "history")}
              >
                <History size={15} />
              </IconButton>
              <div className="knowledge-status" data-testid="knowledge-status">
                <SyncStatus
                  facts={{
                    error,
                    conflicts: state.conflicts.length,
                    hasTarget: !!state.sync.target,
                    pending,
                    lastSyncedAt: state.sync.lastSyncedAt,
                    syncing,
                  }}
                  auto={auto}
                  onToggleAuto={setAuto}
                  onSync={() => void sync()}
                  onOpenSettings={() => setPanel("sync")}
                  onViewConflicts={() => setPanel("conflicts")}
                />
              </div>
              <NoteActionsMenu
                actions={[
                  {
                    label: "移动笔记",
                    icon: <Folder size={15} />,
                    disabled: !note || locked,
                    run: () => note && setMoveTarget({ noteId: note.id }),
                  },
                  {
                    label: "导出这篇笔记",
                    icon: <Download size={15} />,
                    disabled: !note || busy,
                    run: () => void run(exportNote),
                  },
                  {
                    label: favorite ? "取消收藏" : "收藏当前笔记",
                    icon: <Star size={15} />,
                    disabled: !note,
                    run: () =>
                      note && workbench.setState((current) => toggleFavorite(current, note.id)),
                  },
                  {
                    label: "版本历史",
                    icon: <History size={15} />,
                    run: () => setPanel("history"),
                  },
                  {
                    label: "同步设置",
                    icon: <Settings2 size={15} />,
                    separator: true,
                    run: () => setPanel("sync"),
                  },
                  {
                    label: "立即同步",
                    icon: <RefreshCw size={15} />,
                    disabled: syncing || busy,
                    run: () => void sync(),
                  },
                  {
                    label: "删除",
                    icon: <Trash2 size={15} />,
                    separator: true,
                    danger: true,
                    disabled: !note || locked,
                    run: () => setConfirmDelete(true),
                  },
                ]}
              />
            </>
          }
          onSelect={(id) => go(() => select(id))}
          onClose={(id) =>
            void run(async () => {
              await flushEditor();
              const remaining = workbench.state.tabs.filter(
                (item) => item !== id && Object.hasOwn(state.notes, item),
              );
              workbench.setState((current) => closeNote(current, id));
              sessions.delete(id);
              if (id === note?.id) {
                if (remaining.length) await select(remaining.at(-1)!);
                else {
                  setClosedAll(true);
                  await navigate({ to: "/knowledge", search: {} });
                }
              }
            })
          }
          onTogglePin={(id) => workbench.setState((current) => togglePinned(current, id))}
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
            <IconButton
              label="关闭提示"
              size="sm"
              onClick={() => {
                setError("");
                setMessage("");
              }}
            >
              <X size={15} />
            </IconButton>
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
            title="同步设置"
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
              flush={flushEditor}
              onViewConflicts={() => setPanel("conflicts")}
            />
          </KnowledgeDialog>
          <KnowledgeDialog
            open={active && panel === "conflicts"}
            title="处理冲突"
            onClose={() => setPanel(null)}
            error={error}
          >
            <ConflictList
              conflicts={state.conflicts}
              busy={busy || syncing}
              onResolve={(conflict, choice: ConflictChoice, merged) =>
                void run(async () => {
                  if (choice === "merge" && merged) {
                    await store.resolve(conflict, "local");
                    await store.restore(merged);
                    setMessage("已合并双方正文改动；标题与路径保留本机，远端版本已存入历史");
                  } else {
                    await store.resolve(conflict, choice === "remote" ? "remote" : "local");
                    setMessage(
                      choice === "remote"
                        ? "已采用远端版本；本机版本已存入历史"
                        : "已采用本机版本；远端版本已存入历史",
                    );
                  }
                })
              }
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
                  await select(n.id, true);
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
                  <Button variant="ghost" size="sm" onClick={() => setPanel("conflicts")}>
                    处理冲突
                  </Button>
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
            </>
          ) : (
            <section className="knowledge-empty">
              {notes.length ? (
                <>
                  <h2>没有打开的笔记。</h2>
                  <p>在左侧列表选择一篇开始，或按 ⌘/Ctrl K 搜索、新建。</p>
                  <Button variant="ghost" onClick={() => setSwitcher({ query: "" })}>
                    <Search size={15} />
                    打开命令面板
                  </Button>
                </>
              ) : (
                <>
                  <h2>
                    把想法写下来，
                    <br />
                    让知识慢慢生长。
                  </h2>
                  <p>内容保存在本机，连接私有仓库后在设备间同步。</p>
                  <div className="knowledge-empty-actions">
                    <Button variant="primary" disabled={busy} onClick={() => void run(create)}>
                      <Plus size={16} />
                      写第一篇笔记
                    </Button>
                    <Button variant="ghost" onClick={() => input.current?.click()}>
                      导入 Markdown
                    </Button>
                  </div>
                </>
              )}
            </section>
          )}
        </div>
        <nav className="knowledge-mobile-nav" aria-label="笔记视图">
          {VIEW_DEFS.map(([id, label]) => (
            <button type="button" key={id} aria-pressed={view === id} onClick={() => setView(id)}>
              {label}
            </button>
          ))}
          <IconButton
            label="新建笔记"
            className="knowledge-fab"
            disabled={busy}
            onClick={() => void run(create)}
          >
            <Plus size={20} />
          </IconButton>
        </nav>
      </main>
    </div>
  );
}
/** 列表卡片日期：今天走 relativeTime 语义，昨天/N 天前递进，更早保留日期。 */
export function noteWhen(ts: number, now = Date.now()): string {
  if (!Number.isFinite(ts) || ts <= 0) return "未知时间";
  const dayStart = (value: number) => {
    const date = new Date(value);
    date.setHours(0, 0, 0, 0);
    return date.getTime();
  };
  const days = Math.round((dayStart(now) - dayStart(ts)) / 86_400_000);
  if (days <= 0) return relativeTime(ts, now);
  if (days === 1) return "昨天";
  if (days < 7) return `${days} 天前`;
  return new Date(ts).toLocaleDateString();
}
function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob),
    link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 5_000);
}
