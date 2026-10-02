import {
  useMediaQuery,
  useOpenAssistant,
  useRuntime,
  useRuntimeActivity,
  useCredential,
  useUpdateParticipant,
} from "@bcr/react";
import { knowledgeCredentialId } from "../sync/credential";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import {
  FileText,
  Folder,
  FolderPlus,
  Pencil,
  Plus,
  SquareArrowOutUpRight,
  Star,
  Trash2,
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
import { workspaceServices } from "../../workspace";
import { KNOWLEDGE_PATH } from "../../shell/host-manifests";
import { pendingCount } from "../session/model";
import { noteMarkdown } from "../storage/files";
import { writeMarkdownArchive } from "../storage/backup";
import { attachmentReferences } from "../attachments/attachmentModel";
import { createKnowledgeActions } from "../notes/actions";
import { useKnowledgeSync } from "../sync/useKnowledgeSync";
import { useAutoSync } from "../sync/useAutoSync";
import { type EditorHandle } from "../editor/NoteEditor";
import { searchKnowledge, noteSearchHit } from "../search/retrieval";
import { EditorSessions } from "../editor/editorSessions";
import { KnowledgeLinkIndex, resolveNoteLink, splitNoteTarget } from "../notes/markdownAnalysis";
import { useWorkbench } from "./useWorkbench";
import { openNote, setSidebar, toggleFavorite } from "./workbench";
import { knowledgePaletteActions } from "./knowledgePalette";
import { type TreeDrag, type TreeTarget } from "./NoteFileTree";
import { type TreeMenuItem } from "./TreeMenu";
import { normalizeFolderPath, notePath, parentPath, pathKey } from "../notes/paths";
import { showUndoToast } from "./undoToast";
import { type MoveTarget } from "./NoteMove";
export function useKnowledgeWorkbench() {
  const services = useRuntime(),
    active = useRuntimeActivity(),
    mobile = useMediaQuery("(width <= 45em)"),
    openAssistant = useOpenAssistant(),
    navigate = useNavigate();
  const store = useMemo(() => workspaceServices(services).knowledge, [services]);
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
    () => createKnowledgeActions(store, workspaceServices(services).research, flushEditor),
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

  return {
    services,
    active,
    mobile,
    openAssistant,
    navigate,
    store,
    state,
    ready,
    setReady,
    error,
    setError,
    message,
    setMessage,
    busy,
    query,
    setQuery,
    collection,
    setCollection,
    panel,
    setPanel,
    drawer,
    setDrawer,
    sidebarToggle,
    focusMode,
    setFocusMode,
    token,
    auto,
    setAuto,
    collectionName,
    setCollectionName,
    addingCollection,
    setAddingCollection,
    confirmDelete,
    setConfirmDelete,
    treeMenu,
    setTreeMenu,
    treeEdit,
    setTreeEdit,
    folderDelete,
    setFolderDelete,
    moveTarget,
    setMoveTarget,
    sessions,
    view,
    setView,
    switcher,
    setSwitcher,
    target,
    setTarget,
    editor,
    input,
    search,
    toolbarSlot,
    setToolbarSlot,
    sidebarElement,
    content,
    scrollPositions,
    setClosedAll,
    notes,
    note,
    workbench,
    sidebar,
    backlinks,
    filtered,
    pending,
    run,
    go,
    select,
    flushEditor,
    commitTreeEdit,
    dropMove,
    removeFolder,
    treeItems,
    actions,
    create,
    openResult,
    openLink,
    sync,
    syncing,
    importResearch,
    exportAll,
    exportNote,
    exportMarkdown,
    locked,
    favorite,
    clearFilters,
    paletteActions,
  };
}

export type KnowledgeWorkbench = ReturnType<typeof useKnowledgeWorkbench>;

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob),
    link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 5_000);
}
