import {
  Button,
  IconButton,
  Select,
  useRuntime,
  useRuntimeActivity,
  useCredential,
  useUpdateParticipant,
} from "@bcr/react";
import { knowledgeCredentialId } from "./credential";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import {
  BookOpenText,
  Clock,
  Download,
  FileText,
  Files,
  Folder,
  FolderPlus,
  History,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  SquareArrowOutUpRight,
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
  type CSSProperties,
} from "react";
import { workspaceServices } from "../workspace";
import { KNOWLEDGE_PATH } from "../shell/host-manifests";
import { assessExcerpt } from "../research/index";
import { pendingCount } from "./model";
import { noteMarkdown } from "./files";
import { createKnowledgeActions } from "./actions";
import { useKnowledgeSync } from "./useKnowledgeSync";
import { useAutoSync } from "./useAutoSync";
import { NoteEditor, type EditorHandle } from "./NoteEditor";
import { KnowledgeSyncPanel } from "./KnowledgeSyncPanel";
import { KnowledgeHistory } from "./KnowledgeHistory";
import { SyncStatus } from "./syncPopover";
import { ConflictList, type ConflictChoice } from "./conflicts";
import "./knowledge.css";
import "./workbench.css";
import { searchKnowledge, noteSearchHit } from "./retrieval";
import { KnowledgeRestorePanel } from "./KnowledgeRestorePanel";
import { EditorSessions } from "./editorSessions";
import { KnowledgeLinkIndex, resolveNoteLink, splitNoteTarget } from "./markdownAnalysis";
import { useWorkbench } from "./useWorkbench";
import {
  closeNote,
  openNote,
  setContext,
  setContextWidth,
  setSidebar,
  setSidebarWidth,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
  toggleFavorite,
  togglePinned,
} from "./workbench";
import { KnowledgeStore } from "./store";
import { NoteTabs } from "./NoteTabs";
import { knowledgePaletteActions } from "./knowledgePalette";
import { KnowledgeBootError, KnowledgeBootShell } from "./KnowledgeBoot";
import { PanelResizer } from "./PanelResizer";
import { NoteActionsMenu } from "./NoteActionsMenu";
import { NoteSwitcher } from "./NoteSwitcher";
import { KnowledgeDialog } from "./KnowledgeDialog";
import { NoteFileTree, type TreeDrag, type TreeTarget } from "./NoteFileTree";
import { TreeMenu, type TreeMenuItem } from "./TreeMenu";
import { normalizeFolderPath, notePath, parentPath, pathKey } from "./paths";
import { showUndoToast } from "./undoToast";
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
  const [panel, setPanel] = useState<"sync" | "history" | "restore" | "conflicts" | null>(null);
  // 移动端抽屉覆盖层（show-sidebar）与桌面侧栏形态（workbench.sidebar）正交：
  // 抽屉只在 ≤bp-md 生效，形态只在 >bp-md 生效，互不干扰。
  const [drawer, setDrawer] = useState(false);
  // 专注模式：外壳持有，命令面板与 Esc 才能开关；渲染成 data-focus-mode 供样式收起 chrome。
  const [focusMode, setFocusMode] = useState(false);
  const credential = useCredential(knowledgeCredentialId(state.sync.target));
  const token = credential.value;
  const [auto, setAuto] = useAutoSync(state.sync.target, setError);
  const [collectionName, setCollectionName] = useState(""),
    [addingCollection, setAddingCollection] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [treeMenu, setTreeMenu] = useState<{
    x: number;
    y: number;
    target: TreeTarget;
  } | null>(null);
  const [treeEdit, setTreeEdit] = useState<{
    kind: "create" | "rename";
    parent: string;
    path: string;
  } | null>(null);
  const [folderDelete, setFolderDelete] = useState<string | null>(null);
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
    input = useRef<HTMLInputElement>(null),
    search = useRef<HTMLInputElement>(null);
  const sidebarElement = useRef<HTMLElement>(null);
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
  // 侧栏形态随 workbench 持久化，刷新后保持；rail/hidden 都是桌面收起态。
  const sidebar = workbench.state.sidebar;
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
      if (!chord) {
        // ⌘/Ctrl+B 切换侧栏展开↔收起（与 VS Code 一致）；停在 rail 需用侧栏按钮。
        if (
          (event.ctrlKey || event.metaKey) &&
          pressed === "b" &&
          !event.altKey &&
          !event.shiftKey
        ) {
          event.preventDefault();
          event.stopPropagation();
          workbench.setState((current) =>
            setSidebar(current, current.sidebar === "expanded" ? "hidden" : "expanded"),
          );
          return;
        }
        // Esc 退出专注模式；浮层/对话框/⋯ 菜单在前时让它们先收（本监听在捕获阶段）。
        if (event.key === "Escape" && focusMode) {
          if (
            document.querySelector("dialog[open]") ||
            document.querySelector("[popover]:popover-open") ||
            document.querySelector(".knowledge-tools-menu[data-open='true']")
          )
            return;
          event.preventDefault();
          setFocusMode(false);
        }
        return;
      }
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
  }, [active, ready, focusMode]);
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
    await navigate({ to: KNOWLEDGE_PATH, search: { note: id } });
    setDrawer(false);
    setConfirmDelete(null);
  };
  const flushEditor = useCallback(async () => {
    await editor.current?.flush();
  }, []);
  const treeToast = (links: number, undo: () => Promise<void>, text: string) =>
    showUndoToast(links ? `${text}并更新 ${links} 处链接` : text, () => {
      void run(undo);
    });
  async function commitTreeEdit(value: string) {
    const edit = treeEdit;
    setTreeEdit(null);
    const name = value.trim();
    if (!edit || !name) return;
    await run(async () => {
      if (edit.kind === "create") {
        const path = normalizeFolderPath(edit.parent ? `${edit.parent}/${name}` : name);
        await store.saveFolder(path);
        showUndoToast(`已新建目录「${name}」`, () => {
          void run(() => store.removeFolders([path]));
        });
      } else {
        const dest = normalizeFolderPath(
          parentPath(edit.path) ? `${parentPath(edit.path)}/${name}` : name,
        );
        if (pathKey(dest) === pathKey(edit.path)) return;
        const moved = await store.moveFolder(edit.path, dest);
        treeToast(moved.links, moved.undo, "已重命名目录");
      }
    });
  }
  async function dropMove(payload: TreeDrag, destination: string) {
    const snapshot = store.getSnapshot();
    await run(async () => {
      if (payload.kind === "folder") {
        const name = payload.path.split("/").at(-1)!;
        const dest = destination ? `${destination}/${name}` : name;
        if (
          pathKey(dest).startsWith(`${pathKey(payload.path)}/`) ||
          pathKey(dest) === pathKey(payload.path)
        )
          return;
        const moved = await store.moveFolder(payload.path, dest);
        treeToast(moved.links, moved.undo, "已移动目录");
      } else {
        const target = snapshot.notes[payload.id];
        if (!target) return;
        const dest = `${destination ? `${destination}/` : ""}${notePath(target).split("/").at(-1)!}`;
        if (pathKey(dest) === pathKey(notePath(target))) return;
        const moved = await store.moveNotes({ [payload.id]: dest });
        treeToast(moved.links, moved.undo, "已移动笔记");
      }
    });
  }
  async function removeFolder(path: string) {
    await run(async () => {
      const removed = await store.deleteFolder(path);
      treeToast(removed.links, removed.undo, "已删除目录");
    });
  }
  const treeItems = (target: TreeTarget): TreeMenuItem[] =>
    target.kind === "root"
      ? [
          {
            label: "新建目录",
            icon: <FolderPlus size={15} />,
            run: () => setTreeEdit({ kind: "create", parent: "", path: "" }),
          },
          { label: "新建笔记", icon: <Plus size={15} />, run: () => void run(create) },
        ]
      : target.kind === "folder"
        ? [
            {
              label: "新建子目录",
              icon: <FolderPlus size={15} />,
              run: () => setTreeEdit({ kind: "create", parent: target.path, path: "" }),
            },
            {
              label: "重命名目录",
              icon: <Pencil size={15} />,
              run: () =>
                setTreeEdit({ kind: "rename", parent: parentPath(target.path), path: target.path }),
            },
            {
              label: "移动到…",
              icon: <Folder size={15} />,
              run: () => setMoveTarget({ folder: target.path }),
            },
            {
              label: "删除目录",
              icon: <Trash2 size={15} />,
              danger: true,
              run: () => {
                const count = notes.filter((item) =>
                  pathKey(notePath(item)).startsWith(`${pathKey(target.path)}/`),
                ).length;
                if (count) setFolderDelete(target.path);
                else void removeFolder(target.path);
              },
            },
          ]
        : [
            {
              label: "打开",
              icon: <FileText size={15} />,
              run: () =>
                go(async () => {
                  await select(target.id);
                  requestAnimationFrame(() =>
                    document.querySelector<HTMLInputElement>(".knowledge-title")?.focus(),
                  );
                }),
            },
            {
              label: "在新标签打开",
              icon: <SquareArrowOutUpRight size={15} />,
              run: () => go(() => select(target.id, true)),
            },
            {
              label: "重命名",
              icon: <Pencil size={15} />,
              run: () =>
                go(async () => {
                  if (target.id !== note?.id) await select(target.id);
                  requestAnimationFrame(() =>
                    document.querySelector<HTMLInputElement>(".knowledge-title")?.focus(),
                  );
                }),
            },
            {
              label: "移动到…",
              icon: <Folder size={15} />,
              run: () => setMoveTarget({ noteId: target.id }),
            },
            {
              label: workbench.state.favorites.includes(target.id) ? "取消收藏" : "收藏",
              icon: <Star size={15} />,
              run: () => workbench.setState((current) => toggleFavorite(current, target.id)),
            },
            {
              label: "删除",
              icon: <Trash2 size={15} />,
              danger: true,
              disabled: locked,
              run: () => setConfirmDelete(target.id),
            },
          ];
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
      <KnowledgeBootError
        error={error}
        onRetry={() => {
          setError("");
          setReady(false);
          setBootAttempt((attempt) => attempt + 1);
        }}
      />
    ) : (
      <KnowledgeBootShell />
    );
  const locked = !!note && state.conflicts.some((c) => c.kind === "note" && c.key === note.id);
  const favorite = !!note && workbench.state.favorites.includes(note.id);
  const clearFilters = () => {
    setQuery("");
    setCollection("");
    setView("all");
  };
  const paletteActions = knowledgePaletteActions({
    note,
    locked,
    newTargetHint: collection
      ? `「${state.collections[collection]?.name ?? "所选集合"}」`
      : "「未归类」",
    tabCount: workbench.state.tabs.length,
    focusMode,
    setWorkbench: workbench.setState,
    setFocusMode,
    run,
    select,
    create,
    daily: actions.daily,
    flushEditor,
    exportNote,
    importResearch,
    exportAll,
    openPanel: setPanel,
    closeDrawer: () => setDrawer(false),
    moveNote: (id) => setMoveTarget({ noteId: id }),
    confirmDelete: setConfirmDelete,
    importMarkdown: () => input.current?.click(),
  });
  return (
    <div
      className={`knowledge-app ${drawer ? "show-sidebar" : ""}`}
      data-sidebar={sidebar}
      data-context={workbench.state.context}
      data-focus-mode={focusMode ? "on" : undefined}
      style={
        {
          "--w-sidebar-override":
            workbench.state.sidebarWidth === null ? undefined : `${workbench.state.sidebarWidth}px`,
        } as CSSProperties
      }
    >
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
      {drawer && (
        <button
          type="button"
          className="knowledge-backdrop"
          aria-label="关闭笔记列表"
          onClick={() => setDrawer(false)}
        />
      )}
      <aside ref={sidebarElement} className="knowledge-sidebar" aria-label="知识库导航">
        {/* 图标栏：桌面收起后的窄形态（>bp-md 才显示）；rail 态下其余子元素整体隐藏。 */}
        <nav className="knowledge-sidebar-rail" aria-label="知识库快捷栏">
          <IconButton
            label="展开侧栏"
            onClick={() => workbench.setState((current) => setSidebar(current, "expanded"))}
          >
            <PanelLeftOpen size={18} />
          </IconButton>
          <IconButton
            label="筛选笔记"
            onClick={() => {
              workbench.setState((current) => setSidebar(current, "expanded"));
              requestAnimationFrame(() => search.current?.focus());
            }}
          >
            <Search size={18} />
          </IconButton>
          <IconButton label="新建笔记" disabled={busy} onClick={() => void run(create)}>
            <Plus size={18} />
          </IconButton>
          <div className="knowledge-sidebar-rail-views" role="group" aria-label="笔记范围">
            <IconButton
              label="全部笔记"
              aria-pressed={view === "all"}
              onClick={() => setView("all")}
            >
              <Files size={18} />
            </IconButton>
            <IconButton
              label="收藏笔记"
              aria-pressed={view === "favorites"}
              onClick={() => setView("favorites")}
            >
              <Star size={18} />
            </IconButton>
            <IconButton
              label="最近笔记"
              aria-pressed={view === "recent"}
              onClick={() => setView("recent")}
            >
              <Clock size={18} />
            </IconButton>
          </div>
          <IconButton
            label="隐藏侧栏"
            onClick={() => workbench.setState((current) => setSidebar(current, "hidden"))}
          >
            <PanelLeftClose size={18} />
          </IconButton>
        </nav>
        <div className="knowledge-sidebar-heading">
          <span>我的笔记</span>
          <IconButton
            label="新建目录"
            onClick={() => setTreeEdit({ kind: "create", parent: "", path: "" })}
          >
            <FolderPlus size={18} />
          </IconButton>
          <IconButton
            label="收起侧栏"
            className="knowledge-sidebar-collapse"
            onClick={() => workbench.setState((current) => setSidebar(current, "rail"))}
          >
            <PanelLeftClose size={18} />
          </IconButton>
          <IconButton
            label="收起列表"
            className="knowledge-mobile-close"
            onClick={() => setDrawer(false)}
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
        <div className="knowledge-search-row">
          <label className="knowledge-search">
            <Search size={15} />
            <input
              ref={search}
              aria-label="筛选笔记列表"
              placeholder="筛选笔记…"
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
                aria-label="清除筛选"
                onClick={(event) => {
                  setQuery("");
                  event.currentTarget.closest("label")?.querySelector("input")?.focus();
                }}
              >
                <X size={14} />
              </button>
            )}
          </label>
          <div className="knowledge-collection-row">
            <Select
              aria-label="筛选笔记集合"
              className="knowledge-select"
              value={collection}
              onChange={(e) => setCollection(e.target.value)}
            >
              <option value="">全部笔记</option>
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
        </div>
        {/* 筛选行：范围细分段，两个筛选维度（文本/集合在上一行，范围在此行）。 */}
        <div className="knowledge-filter-row">
          <div className="knowledge-segmented" role="group" aria-label="笔记范围">
            {VIEW_DEFS.map(([id, label]) => (
              <button type="button" key={id} aria-pressed={view === id} onClick={() => setView(id)}>
                {label}
              </button>
            ))}
          </div>
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
          {filtered.length ? (
            <NoteFileTree
              notes={filtered}
              activeId={note?.id}
              folders={state.folders}
              editing={treeEdit}
              onSelect={(id) =>
                go(async () => {
                  await select(id);
                  if (query.trim())
                    setTarget((old) => ({
                      id,
                      offset: noteSearchHit(state.notes[id]!, query).match?.start ?? 0,
                      sequence: (old?.sequence ?? 0) + 1,
                    }));
                })
              }
              onOpen={(id) => go(() => select(id, true))}
              onMoveFolder={(folder) => setMoveTarget({ folder })}
              onEditCommit={(value) => void commitTreeEdit(value)}
              onEditCancel={() => setTreeEdit(null)}
              onMenu={(event, target) => {
                event.preventDefault();
                setTreeMenu({ x: event.clientX, y: event.clientY, target });
              }}
              onDropMove={(payload, destination) => void dropMove(payload, destination)}
            />
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
              setDrawer(false);
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
        <PanelResizer
          edge="right"
          variable="--w-sidebar-override"
          label="调整侧边栏宽度"
          width={workbench.state.sidebarWidth}
          min={SIDEBAR_MIN_WIDTH}
          max={SIDEBAR_MAX_WIDTH}
          getPanel={() => sidebarElement.current}
          onCommit={(width) => workbench.setState((current) => setSidebarWidth(current, width))}
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
          open={confirmDelete !== null}
          title="删除笔记"
          onClose={() => setConfirmDelete(null)}
          error={error}
        >
          <p>
            删除「{state.notes[confirmDelete ?? ""]?.title || "未命名笔记"}
            」？之后仍可从版本历史恢复。
          </p>
          <div className="knowledge-dialog-actions">
            <Button variant="ghost" onClick={() => setConfirmDelete(null)}>
              取消
            </Button>
            <Button
              variant="danger"
              disabled={busy || locked}
              onClick={() =>
                void run(async () => {
                  const id = confirmDelete;
                  if (!id) return;
                  await flushEditor();
                  await store.deleteNote(id);
                  await navigate({ to: KNOWLEDGE_PATH, search: {} });
                  setConfirmDelete(null);
                })
              }
            >
              确认删除笔记
            </Button>
          </div>
        </KnowledgeDialog>
        <KnowledgeDialog
          open={folderDelete !== null}
          title="删除目录"
          onClose={() => setFolderDelete(null)}
          error={error}
        >
          <p>
            删除「{folderDelete ?? ""}」？其中的{" "}
            {
              notes.filter((item) =>
                pathKey(notePath(item)).startsWith(`${pathKey(folderDelete ?? "\u0000")}/`),
              ).length
            }{" "}
            篇笔记将移到库根并改写引用，子目录一并删除。
          </p>
          <div className="knowledge-dialog-actions">
            <Button variant="ghost" onClick={() => setFolderDelete(null)}>
              取消
            </Button>
            <Button
              variant="danger"
              disabled={busy}
              onClick={() => {
                const path = folderDelete;
                setFolderDelete(null);
                if (path) void removeFolder(path);
              }}
            >
              确认删除目录
            </Button>
          </div>
        </KnowledgeDialog>
        {treeMenu && (
          <TreeMenu
            x={treeMenu.x}
            y={treeMenu.y}
            items={treeItems(treeMenu.target)}
            onClose={() => setTreeMenu(null)}
          />
        )}
        <NoteTabs
          leading={
            <IconButton
              label="打开笔记列表"
              className="knowledge-menu"
              onClick={() => {
                // 移动端开抽屉，桌面端把侧栏展开（两个状态各管各的断点）。
                setDrawer(true);
                workbench.setState((current) => setSidebar(current, "expanded"));
              }}
            >
              <Menu size={18} />
            </IconButton>
          }
          notes={state.notes}
          ids={workbench.state.tabs}
          pinned={workbench.state.pinned}
          activeId={note?.id}
          actions={
            /* 同步/保存状态是应用级事实（无打开笔记时也要可见），安静地留在标签条右端。 */
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
                  await navigate({ to: KNOWLEDGE_PATH, search: {} });
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
                    // 「合并」是两步组合：正文取合并结果（restore 走历史可回滚），
                    // 标题与路径必须保留本机（改名/移动要走修改计划），故先 resolve 本机。
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
                focusMode={focusMode}
                onFocusModeChange={setFocusMode}
                contextOpen={workbench.state.context === "expanded"}
                onContextOpenChange={(open) =>
                  workbench.setState((current) => setContext(current, open ? "expanded" : "hidden"))
                }
                contextWidth={workbench.state.contextWidth}
                onContextWidthChange={(width) =>
                  workbench.setState((current) => setContextWidth(current, width))
                }
                documentActions={
                  /* 收藏与版本历史也在这条 ⋯ 菜单里；菜单跟随文档工具行，标签栏不再各留按钮。 */
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
                        run: () => note && setConfirmDelete(note.id),
                      },
                    ]}
                  />
                }
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
function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob),
    link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 5_000);
}
