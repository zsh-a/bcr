import {
  AppToolbar,
  Button,
  ResourceHeader,
  ResourceSearch,
  ResourceViews,
  useMediaQuery,
  useOpenAssistant,
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
  Maximize2,
  Minimize2,
  PanelRightClose,
  PanelRightOpen,
  Sparkles,
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
import { writeMarkdownArchive } from "./backup";
import { attachmentReferences } from "./attachmentModel";
import { createKnowledgeActions } from "./actions";
import { useKnowledgeSync } from "./useKnowledgeSync";
import { useAutoSync } from "./useAutoSync";
import { NoteEditor, type EditorHandle } from "./NoteEditor";
import { KnowledgeSyncPanel } from "./KnowledgeSyncPanel";
import { KnowledgeHistory } from "./KnowledgeHistory";
import { SyncStatus } from "./syncPopover";
import { ConflictList, type ConflictChoice } from "./conflicts";
import "./fonts.scss";
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
import { NoteResults } from "./NoteResults";
import { NoteFileTree, type TreeDrag, type TreeTarget } from "./NoteFileTree";
import { TreeMenu, type TreeMenuItem } from "./TreeMenu";
import { normalizeFolderPath, notePath, parentPath, pathKey } from "./paths";
import { showUndoToast } from "./undoToast";
import { NoteMove, type MoveTarget } from "./NoteMove";
import "./paths.css";
import "./resource-layout.css";

const VIEW_DEFS = [
  ["all", "全部"],
  ["favorites", "收藏"],
  ["recent", "最近"],
] as const;

export function KnowledgeApp() {
  const services = useRuntime(),
    active = useRuntimeActivity(),
    mobile = useMediaQuery("(width <= 45em)"),
    openAssistant = useOpenAssistant(),
    navigate = useNavigate();
  const [bootAttempt, setBootAttempt] = useState(0);
  // 启动失败后重试会换一个全新的存储会话重新载入；首个会话仍走共享组合根。
  const store = useMemo(
    () =>
      bootAttempt === 0
        ? workspaceServices(services.metadata, services.binary, services).knowledge
        : new KnowledgeStore(services.metadata, services.binary, services),
    [services, bootAttempt],
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
  const sidebarToggle = useRef<HTMLButtonElement>(null);
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
  const [toolbarSlot, setToolbarSlot] = useState<HTMLDivElement | null>(null);
  const sidebarElement = useRef<HTMLElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const scrollPositions = useRef(new Map<string, number>());
  const selectedId = useRouterState({
    select: (s) => (s.location.search as { note?: string }).note,
  });
  // 关闭最后一个标签后显式回到空状态；直达 /knowledge（无 ?note）仍显示最近笔记。
  const [closedAll, setClosedAll] = useState(false);
  const notes = useMemo(
    () =>
      Object.values(state.notes).sort(
        (a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id),
      ),
    [state.notes],
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
    if (focusMode) setDrawer(false);
    else if (mobile && drawer) search.current?.focus();
  }, [focusMode, mobile, drawer]);
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
      if (event.defaultPrevented || event.isComposing) return;
      const pressed = event.key.toLowerCase();
      const chord = (event.ctrlKey || event.metaKey) && (pressed === "k" || pressed === "o");
      if (!chord) {
        // 正文优先处理格式快捷键；其他区域的 ⌘/Ctrl+B 切换侧栏。
        if (
          (event.ctrlKey || event.metaKey) &&
          pressed === "b" &&
          !event.altKey &&
          !event.shiftKey &&
          !(event.target instanceof Element && event.target.closest(".knowledge-body")) &&
          !document.querySelector("dialog[open]")
        ) {
          event.preventDefault();
          event.stopPropagation();
          setFocusMode(false);
          if (mobile) setDrawer((open) => !open);
          else
            workbench.setState((current) =>
              setSidebar(current, current.sidebar === "expanded" ? "hidden" : "expanded"),
            );
          return;
        }
        if (
          event.key === "Escape" &&
          mobile &&
          drawer &&
          !treeEdit &&
          !treeMenu &&
          !document.querySelector("dialog[open], [popover]:popover-open")
        ) {
          if (
            event.target instanceof HTMLInputElement &&
            event.target.type === "search" &&
            event.target.value
          )
            return;
          event.preventDefault();
          event.stopPropagation();
          setDrawer(false);
          sidebarToggle.current?.focus();
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
  }, [active, ready, focusMode, mobile, drawer, treeEdit, treeMenu]);
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
  const create = async (title = "") => {
    await select(await actions.create(collection || null, title), true);
    setQuery("");
    setView("all");
  };
  const openResult = (id: string, open = false) =>
    go(async () => {
      await select(id, open);
      const latest = store.getSnapshot().notes[id];
      if (query.trim() && latest)
        setTarget((old) => ({
          id,
          offset: noteSearchHit(latest, query).match?.start ?? 0,
          sequence: (old?.sequence ?? 0) + 1,
        }));
    });
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
    if (saved && attachmentReferences(saved.body).length) {
      download(
        await writeMarkdownArchive(
          {
            notes: { [saved.id]: saved },
            collections: state.collections,
            folders: [],
            attachments: store.getSnapshot().attachments,
          },
          store.attachments,
        ),
        `${saved.title || "未命名笔记"}.zip`,
      );
    } else if (saved)
      download(
        new Blob([noteMarkdown(saved)], { type: "text/markdown;charset=utf-8" }),
        `${saved.title || "未命名笔记"}.md`,
      );
  }
  async function exportMarkdown() {
    await flushEditor();
    download(
      await writeMarkdownArchive(store.getSnapshot(), store.attachments),
      "bcr-knowledge-markdown.zip",
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
      <AppToolbar className="knowledge-toolbar">
        <IconButton
          ref={sidebarToggle}
          label="切换笔记列表"
          title="笔记列表 · Ctrl/⌘+B"
          aria-expanded={!focusMode && (mobile ? drawer : sidebar === "expanded")}
          onClick={() => {
            setFocusMode(false);
            if (mobile) setDrawer((open) => focusMode || !open);
            else
              workbench.setState((current) =>
                setSidebar(
                  current,
                  !focusMode && current.sidebar === "expanded" ? "rail" : "expanded",
                ),
              );
          }}
        >
          {!focusMode && (mobile ? drawer : sidebar === "expanded") ? (
            <PanelLeftClose size={18} />
          ) : (
            <PanelLeftOpen size={18} />
          )}
        </IconButton>
        <strong className="knowledge-app-identity">知识库</strong>
        <NoteTabs
          notes={state.notes}
          ids={workbench.state.tabs}
          pinned={workbench.state.pinned}
          activeId={note?.id}
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

        <div ref={setToolbarSlot} className="knowledge-document-toolbar" />
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
        <IconButton
          label={
            !focusMode && workbench.state.context === "expanded" ? "收起上下文栏" : "展开上下文栏"
          }
          title="笔记信息 · 大纲、链接与属性"
          disabled={!note}
          aria-pressed={!focusMode && workbench.state.context === "expanded"}
          onClick={() => {
            setFocusMode(false);
            workbench.setState((current) =>
              setContext(
                current,
                !focusMode && current.context === "expanded" ? "hidden" : "expanded",
              ),
            );
          }}
        >
          {!focusMode && workbench.state.context === "expanded" ? (
            <PanelRightClose size={17} />
          ) : (
            <PanelRightOpen size={17} />
          )}
        </IconButton>
        <IconButton
          className="knowledge-focus-action"
          label={focusMode ? "退出专注模式" : "进入专注模式"}
          title="专注模式"
          aria-pressed={focusMode}
          onClick={() => setFocusMode(!focusMode)}
        >
          {focusMode ? <Minimize2 size={17} /> : <Maximize2 size={17} />}
        </IconButton>
        <IconButton
          className="knowledge-ai-action"
          label="AI 助手"
          title="AI 助手 · Ctrl/⌘+J"
          disabled={!openAssistant}
          onClick={openAssistant}
        >
          <Sparkles size={17} />
        </IconButton>
        <NoteActionsMenu
          actions={[
            {
              label: "新建笔记",
              icon: <Plus size={15} />,
              disabled: busy,
              run: () => void run(create),
            },
            {
              label: "搜索与切换笔记",
              icon: <Search size={15} />,
              run: () => setSwitcher({ query: "" }),
            },
            {
              label: "新建目录",
              icon: <FolderPlus size={15} />,
              run: () => {
                setFocusMode(false);
                setQuery("");
                setView("all");
                setDrawer(true);
                workbench.setState((current) => setSidebar(current, "expanded"));
                setTreeEdit({ kind: "create", parent: "", path: "" });
              },
            },
            { label: "新建集合", icon: <Plus size={15} />, run: () => setAddingCollection(true) },
            {
              label: "导入 Markdown",
              icon: <Upload size={15} />,
              separator: true,
              run: () => input.current?.click(),
            },
            {
              label: "从资料集合导入",
              icon: <BookOpenText size={15} />,
              disabled: busy,
              run: () => void run(importResearch),
            },
            {
              label: "导出知识库",
              icon: <Download size={15} />,
              disabled: busy,
              run: () => void run(exportAll),
            },
            {
              label: "恢复 ZIP 备份",
              icon: <Upload size={15} />,
              disabled: busy || syncing,
              run: () => setPanel("restore"),
            },
            {
              label: "导出 Markdown 附件包",
              icon: <Download size={15} />,
              disabled: busy,
              run: () => void run(exportMarkdown),
            },
            {
              label: focusMode ? "退出专注模式" : "专注模式",
              icon: <Maximize2 size={15} />,
              separator: true,
              run: () => setFocusMode(!focusMode),
            },
            {
              label: "AI 助手",
              icon: <Sparkles size={15} />,
              disabled: !openAssistant,
              run: () => openAssistant?.(),
            },

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
              run: () => note && workbench.setState((current) => toggleFavorite(current, note.id)),
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
      </AppToolbar>
      <div className="knowledge-layout">
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
          onCreate={create}
          actions={paletteActions}
        />
        <KnowledgeDialog
          open={addingCollection}
          title="新建集合"
          onClose={() => setAddingCollection(false)}
        >
          <form
            className="knowledge-add-collection"
            onSubmit={(event) => {
              event.preventDefault();
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
              autoFocus
              aria-label="新知识集合名称"
              placeholder="集合名称"
              maxLength={200}
              value={collectionName}
              onChange={(event) => setCollectionName(event.target.value)}
            />
            <Button type="submit" disabled={busy || !collectionName.trim()}>
              创建集合
            </Button>
          </form>
        </KnowledgeDialog>
        {drawer && (
          <button
            type="button"
            className="knowledge-backdrop"
            aria-label="关闭笔记列表"
            onClick={() => setDrawer(false)}
          />
        )}
        <aside
          ref={sidebarElement}
          className="knowledge-sidebar"
          aria-label="知识库导航"
          inert={focusMode || (mobile ? !drawer : sidebar === "hidden")}
        >
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
          <ResourceHeader
            className="knowledge-sidebar-heading"
            title={
              <Select
                aria-label="筛选笔记集合"
                className="knowledge-select knowledge-scope-select"
                value={collection}
                onChange={(event) => setCollection(event.target.value)}
              >
                <option value="">全部集合</option>
                {Object.values(state.collections).map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </Select>
            }
            actions={
              <>
                <Button
                  className="knowledge-create"
                  aria-label="新建笔记"
                  title="新建笔记"
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  onClick={() => void run(create)}
                >
                  <Plus size={16} />
                  <span>新建</span>
                </Button>
                <IconButton
                  label="收起列表"
                  className="knowledge-mobile-close"
                  onClick={() => setDrawer(false)}
                >
                  <X size={18} />
                </IconButton>
              </>
            }
          />
          <ResourceSearch
            ref={search}
            className="knowledge-search"
            aria-label="筛选笔记列表"
            placeholder="搜索笔记…"
            value={query}
            onValueChange={setQuery}
            onKeyDown={(event) => {
              if (
                event.key !== "Enter" ||
                event.nativeEvent.isComposing ||
                !query.trim() ||
                !filtered[0]
              )
                return;
              event.preventDefault();
              const first = filtered[0];
              go(async () => {
                await select(first.id, true);
                setTarget((old) => ({
                  id: first.id,
                  offset: noteSearchHit(first, query).match?.start ?? 0,
                  sequence: (old?.sequence ?? 0) + 1,
                }));
              });
            }}
          />
          <ResourceViews
            className="knowledge-filter-row"
            label="笔记范围"
            views={VIEW_DEFS.map(([id, label]) => ({ id, label }))}
            value={view}
            onValueChange={setView}
          />
          {query.trim() && (
            <div className="knowledge-result-count" role="status">
              {filtered.length} 篇匹配 ·{" "}
              {collection ? state.collections[collection]?.name : "全部集合"}
            </div>
          )}
          <nav className="knowledge-note-list" aria-label="笔记列表">
            {query.trim() || view !== "all" ? (
              filtered.length ? (
                <NoteResults
                  notes={filtered}
                  activeId={note?.id}
                  query={query}
                  onSelect={(id) => openResult(id)}
                  onOpen={(id) => openResult(id, true)}
                />
              ) : null
            ) : filtered.length || state.folders.length || treeEdit ? (
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
            ) : null}
            {!filtered.length && !treeEdit && (
              <div className="knowledge-list-empty" role="status">
                <FileText size={25} aria-hidden="true" />
                <strong>
                  {query.trim()
                    ? `未找到与「${query.trim().slice(0, 30)}」匹配的笔记`
                    : view === "favorites"
                      ? "还没有收藏笔记"
                      : view === "recent"
                        ? "还没有最近记录"
                        : collection
                          ? "这个集合还没有笔记"
                          : "从一篇笔记开始"}
                </strong>
                <p>
                  {query.trim()
                    ? "试试其他关键词，或调整搜索范围。"
                    : view === "favorites"
                      ? "收藏常用笔记，之后可以在这里快速找到。"
                      : view === "recent"
                        ? "打开过的笔记会出现在这里。"
                        : "写下想法，也可以导入已有的 Markdown。"}
                </p>
                <div className="knowledge-list-empty-actions">
                  {query && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setQuery("");
                        search.current?.focus();
                      }}
                    >
                      清除搜索
                    </Button>
                  )}
                  {(collection || view !== "all") && (
                    <Button size="sm" variant="ghost" onClick={clearFilters}>
                      重置全部筛选
                    </Button>
                  )}
                  {(query.trim() || view === "all") && (
                    <Button
                      size="sm"
                      variant={query.trim() ? "ghost" : "default"}
                      disabled={busy}
                      onClick={() =>
                        void run(async () => {
                          await select(
                            await actions.create(collection || null, query.trim()),
                            true,
                          );
                          setQuery("");
                          setView("all");
                        })
                      }
                    >
                      {query.trim() ? `以「${query.trim().slice(0, 10)}」新建` : "开始写作"}
                    </Button>
                  )}
                </div>
              </div>
            )}
          </nav>
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
                  contextOpen={workbench.state.context === "expanded"}
                  onContextOpenChange={(open) =>
                    workbench.setState((current) =>
                      setContext(current, open ? "expanded" : "hidden"),
                    )
                  }
                  contextWidth={workbench.state.contextWidth}
                  onContextWidthChange={(width) =>
                    workbench.setState((current) => setContextWidth(current, width))
                  }
                  toolbarSlot={toolbarSlot}
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
        </main>
      </div>
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
