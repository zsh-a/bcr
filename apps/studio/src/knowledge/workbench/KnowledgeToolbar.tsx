import { AppToolbar, IconButton } from "@bcr/react";
import {
  BookOpenText,
  ChevronDown,
  Download,
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
  Plus,
  RefreshCw,
  Search,
  Settings2,
  Star,
  Trash2,
  Upload,
} from "lucide-react";
import { KNOWLEDGE_PATH } from "../../shell/host-manifests";
import { SyncStatus } from "../sync/syncPopover";
import { closeNote, setContext, setSidebar, toggleFavorite, togglePinned } from "./workbench";
import { NoteTabs } from "./NoteTabs";
import { NoteActionsMenu } from "./NoteActionsMenu";
import type { KnowledgeWorkbench } from "./useKnowledgeWorkbench";

export function KnowledgeToolbar({ controller }: { controller: KnowledgeWorkbench }) {
  const {
    mobile,
    openAssistant,
    navigate,
    state,
    error,
    busy,
    setQuery,
    setPanel,
    drawer,
    setDrawer,
    sidebarToggle,
    focusMode,
    setFocusMode,
    auto,
    setAuto,
    setAddingCollection,
    setConfirmDelete,
    setTreeEdit,
    setMoveTarget,
    sessions,
    setView,
    setSwitcher,
    input,
    setToolbarSlot,
    setClosedAll,
    note,
    workbench,
    sidebar,
    pending,
    run,
    go,
    select,
    flushEditor,
    create,
    sync,
    syncing,
    importResearch,
    exportAll,
    exportNote,
    exportMarkdown,
    locked,
    favorite,
  } = controller;
  return (
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
      {mobile ? (
        <button
          type="button"
          className="knowledge-mobile-title"
          aria-label="搜索与切换笔记"
          onClick={() => setSwitcher({ query: "" })}
        >
          <span>{note?.title || (note ? "未命名笔记" : "知识库")}</span>
          <ChevronDown size={14} aria-hidden="true" />
        </button>
      ) : (
        <strong className="knowledge-app-identity">知识库</strong>
      )}
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
        className="knowledge-context-action"
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
  );
}
