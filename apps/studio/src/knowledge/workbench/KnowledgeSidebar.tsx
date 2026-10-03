import {
  Button,
  ResourceHeader,
  ResourceSearch,
  ResourceViews,
  IconButton,
  Select,
} from "@bcr/react";
import {
  Clock,
  FileText,
  Files,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Search,
  Star,
} from "lucide-react";
import { noteSearchHit } from "../search/retrieval";
import { setSidebar, setSidebarWidth, SIDEBAR_MAX_WIDTH, SIDEBAR_MIN_WIDTH } from "./workbench";
import { PanelResizer } from "./PanelResizer";
import { NoteResults } from "./NoteResults";
import { NoteFileTree } from "./NoteFileTree";
import type { KnowledgeWorkbench } from "./useKnowledgeWorkbench";
const VIEW_DEFS = [
  ["all", "全部"],
  ["favorites", "收藏"],
  ["recent", "最近"],
] as const;

export function KnowledgeSidebar({ controller }: { controller: KnowledgeWorkbench }) {
  const {
    mobile,
    state,
    busy,
    query,
    setQuery,
    collection,
    setCollection,
    drawer,
    focusMode,
    setTreeMenu,
    treeEdit,
    setTreeEdit,
    setMoveTarget,
    view,
    setView,
    setTarget,
    input,
    search,
    sidebarElement,
    note,
    workbench,
    sidebar,
    filtered,
    run,
    go,
    select,
    commitTreeEdit,
    dropMove,
    actions,
    create,
    openResult,
    clearFilters,
  } = controller;
  return (
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
          <IconButton label="全部笔记" aria-pressed={view === "all"} onClick={() => setView("all")}>
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
          {filtered.length} 篇匹配 · {collection ? state.collections[collection]?.name : "全部集合"}
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
                      await select(await actions.create(collection || null, query.trim()), true);
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
  );
}
