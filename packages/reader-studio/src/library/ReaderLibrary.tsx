import {
  Archive,
  BookOpen,
  Info,
  LibraryBig,
  PanelLeftClose,
  Plus,
  Pencil,
  Star,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { lazy, Suspense, useRef, useState } from "react";
import { ActionMenu, ContextMenu, ResourceSearch, type ContextMenuAction } from "@bcr/react";
import { readerAcceptAttribute, type ReaderBook } from "@bcr/reader-core";
import { readingStatus, type ReaderReadingStatus } from "../state/model";
import type { ReaderRuntime } from "../runtime";
import { reader } from "../state/store";
import { useReader } from "../state/useReader";
import { persistReaderSnapshot } from "../workbench/useReaderRuntime";
import { ReaderSheet } from "../workbench/ReaderSheet";
import { ReaderLibraryBook } from "./ReaderLibraryBook";
import { ReaderLibraryBookDialog, type BookDialogMode } from "./ReaderLibraryBookDialog";
const ReaderBackupPanel = lazy(() =>
  import("../persistence/ReaderBackupPanel").then((module) => ({
    default: module.ReaderBackupPanel,
  })),
);

export function LibraryPanel(props: {
  runtime: ReaderRuntime;
  onImport: (files: ReadonlyArray<File>) => void;
  mode?: "quick" | "manage";
  onClose?: () => void;
}) {
  const library = useReader((state) => state.library);
  const activeBookId = useReader((state) => state.activeBookId);
  const sidebarOpen = useReader((state) => state.sidebarOpen);
  const progressByBook = useReader((state) => state.progressByBook);
  const fileInput = useRef<HTMLInputElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const dialogSequence = useRef(0);
  const full = props.mode === "manage";
  const [managerOpen, setManagerOpen] = useState(false);
  const dragDepth = useRef(0);
  const [dragging, setDragging] = useState(false);
  const [sortMode, setSortMode] = useState<LibrarySortMode>("recent");
  const [filter, setFilter] = useState<ReaderReadingStatus | "all">("all");
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [titleFilter, setTitleFilter] = useState("");
  const [managing, setManaging] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [batchConfirm, setBatchConfirm] = useState(false);
  const sourceErrors = useReader((state) => state.sourceErrorsByBook);
  const [context, setContext] = useState<{
    id: string;
    x: number;
    y: number;
    trigger: HTMLElement;
  } | null>(null);
  const [bookDialog, setBookDialog] = useState<{
    id: string;
    mode: BookDialogMode;
    sequence: number;
  } | null>(null);
  const [backupOpen, setBackupOpen] = useState(false);
  const menuBook = library.find((book) => book.id === context?.id);
  const dialogBook = library.find((book) => book.id === bookDialog?.id) ?? null;
  const missingSource = (book: ReaderBook) =>
    Boolean(sourceErrors[book.id]) ||
    (book.source.format === "pdf" && !book.source.ref && !book.source.objectUrl);
  const openBook = (id: string) => {
    reader.openBook(id);
    props.onClose?.();
    if (sidebarOpen && window.matchMedia("(max-width: 860px)").matches) reader.toggleSidebar();
  };
  const showBookDialog = (id: string, mode: BookDialogMode, trigger?: HTMLElement) => {
    trigger?.focus({ preventScroll: true });
    setContext(null);
    setBookDialog({ id, mode, sequence: ++dialogSequence.current });
  };
  const menuActions: ContextMenuAction[] = menuBook
    ? [
        { id: "open", label: "打开读物", icon: <BookOpen />, run: () => openBook(menuBook.id) },
        {
          id: "favorite",
          label: menuBook.favorite ? "取消收藏" : "收藏读物",
          icon: <Star />,
          separated: true,
          run: () => reader.toggleFavorite(menuBook.id),
        },
        {
          id: "rename",
          label: "重命名…",
          icon: <Pencil />,
          shortcut: "F2",
          run: () => showBookDialog(menuBook.id, "rename"),
        },
        {
          id: "details",
          label: "读物详情",
          icon: <Info />,
          run: () => showBookDialog(menuBook.id, "details"),
        },
        {
          id: "remove",
          label: "移除读物…",
          icon: <Trash2 />,
          danger: true,
          separated: true,
          run: () => showBookDialog(menuBook.id, "remove"),
        },
      ]
    : [];
  const sortedLibrary = library
    .filter(
      (book) =>
        (filter === "all" || readingStatus(progressByBook[book.id]?.percentage) === filter) &&
        (!favoritesOnly || book.favorite) &&
        `${book.title}\n${book.author ?? ""}`
          .toLocaleLowerCase()
          .includes(titleFilter.trim().toLocaleLowerCase()),
    )
    .sort((left, right) => {
      if (sortMode === "title") return left.title.localeCompare(right.title, "zh-CN");
      if (sortMode === "imported") return right.importedAt - left.importedAt;
      if (sortMode === "favorite") {
        const difference = Number(Boolean(right.favorite)) - Number(Boolean(left.favorite));
        if (difference) return difference;
      }
      if (sortMode === "progress") {
        return (
          (progressByBook[right.id]?.percentage ?? 0) - (progressByBook[left.id]?.percentage ?? 0)
        );
      }
      return (
        (progressByBook[right.id]?.updatedAt ?? right.updatedAt) -
        (progressByBook[left.id]?.updatedAt ?? left.updatedAt)
      );
    });
  const selectedBooks = library.filter((book) => selected.has(book.id));
  const toggleSelection = (id: string) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  return (
    <div
      ref={panelRef}
      className={`reader-library-panel ${full ? "reader-library-full" : "reader-library-quick"}`}
      onDragEnter={(event) => {
        if (!event.dataTransfer.types.includes("Files")) return;
        event.preventDefault();
        dragDepth.current++;
        setDragging(true);
      }}
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes("Files")) event.preventDefault();
      }}
      onDragLeave={() => {
        dragDepth.current = Math.max(0, dragDepth.current - 1);
        if (!dragDepth.current) setDragging(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        dragDepth.current = 0;
        setDragging(false);
        if (event.dataTransfer.files.length) props.onImport([...event.dataTransfer.files]);
      }}
    >
      <div className="reader-sidebar-heading">
        <div>
          <strong id={full ? "reader-library-manager-title" : "reader-library-title"}>
            {full ? "我的书库" : "书库"}
          </strong>
          <span className="reader-library-count">{library.length} 本</span>
        </div>
        <button
          type="button"
          className="ui-btn ui-icon-btn ui-btn-ghost"
          aria-label="添加本地读物"
          title="添加本地读物"
          onClick={() => fileInput.current?.click()}
        >
          <Plus className="reader-icon" />
        </button>
        <ActionMenu label="书库操作" variant="menu">
          <button
            type="button"
            role="menuitem"
            disabled={!activeBookId}
            onClick={() => {
              if (!activeBookId) return;
              const trigger =
                panelRef.current?.querySelector<HTMLElement>(
                  `.reader-book-entry[data-book-id="${CSS.escape(activeBookId)}"] > button`,
                ) ?? panelRef.current?.querySelector<HTMLElement>('[aria-label="书库操作"]');
              if (!trigger) return;
              const box = trigger.getBoundingClientRect();
              setContext({
                id: activeBookId,
                trigger,
                x: box.left + 16,
                y: box.top + Math.min(box.height, 44),
              });
            }}
          >
            <Info />
            管理当前读物
          </button>
          {!full && (
            <button type="button" role="menuitem" onClick={() => setManagerOpen(true)}>
              <LibraryBig />
              管理书库
            </button>
          )}
          <button type="button" role="menuitem" onClick={() => setBackupOpen(true)}>
            <Archive />
            备份与恢复
          </button>
        </ActionMenu>
        <button
          type="button"
          className="ui-btn ui-icon-btn ui-btn-ghost"
          onClick={() => (full ? props.onClose?.() : reader.toggleSidebar())}
          aria-label={full ? "关闭书库管理" : "收起书库"}
        >
          {full ? <X className="reader-icon" /> : <PanelLeftClose className="reader-icon" />}
        </button>
      </div>
      <ResourceSearch
        ref={searchInput}
        className="reader-library-resource-search"
        aria-label="筛选书名或作者"
        placeholder="搜索书库…"
        value={titleFilter}
        onValueChange={setTitleFilter}
      />
      {full && (
        <>
          <div className="reader-library-toolbar">
            <select
              aria-label="阅读状态筛选"
              value={filter}
              onChange={(event) => setFilter(event.target.value as ReaderReadingStatus | "all")}
            >
              <option value="all">全部读物</option>
              <option value="unread">未读</option>
              <option value="reading">在读</option>
              <option value="finished">读完</option>
            </select>
            <span className="reader-library-sort-label">排序</span>
            <select
              aria-label="书库排序"
              value={sortMode}
              onChange={(event) => setSortMode(event.target.value as LibrarySortMode)}
            >
              <option value="recent">最近阅读</option>
              <option value="title">标题</option>
              <option value="progress">阅读进度</option>
              <option value="imported">最近添加</option>
              <option value="favorite">收藏优先</option>
            </select>
          </div>
          <div className="reader-library-management">
            <label>
              <input
                type="checkbox"
                checked={favoritesOnly}
                onChange={(event) => setFavoritesOnly(event.target.checked)}
              />
              仅收藏
            </label>
            <button
              type="button"
              className="ui-btn ui-btn-default"
              aria-pressed={managing}
              onClick={() => {
                setManaging(!managing);
                setSelected(new Set());
                setContext(null);
              }}
            >
              {managing ? "完成选择" : "批量管理"}
            </button>
          </div>
        </>
      )}
      {dragging && (
        <div className="reader-dropzone is-dragging">
          <Upload className="reader-dropzone-icon" />
          <strong>松开以添加读物</strong>
          <small>TXT · MD · HTML · DOCX · EPUB · PDF · CBZ</small>
        </div>
      )}
      <input
        ref={fileInput}
        hidden
        tabIndex={-1}
        type="file"
        multiple
        accept={readerAcceptAttribute()}
        aria-label="导入阅读文件"
        onChange={(event) => {
          const files = [...(event.target.files ?? [])];
          event.target.value = "";
          props.onImport(files);
        }}
      />
      <Suspense fallback={backupOpen ? <p role="status">正在打开备份工具…</p> : null}>
        <ReaderBackupPanel
          open={backupOpen}
          runtime={props.runtime}
          onClose={() => setBackupOpen(false)}
        />
      </Suspense>
      {managing && (
        <div className="reader-library-batch">
          <span role="status">已选择 {selectedBooks.length} 本</span>
          <button
            type="button"
            className="ui-btn ui-btn-default"
            disabled={!sortedLibrary.length}
            onClick={() =>
              setSelected(
                (current) => new Set([...current, ...sortedLibrary.map((book) => book.id)]),
              )
            }
          >
            选择当前列表
          </button>
          <button
            type="button"
            className="ui-btn ui-btn-default"
            disabled={!selectedBooks.length}
            onClick={() => setSelected(new Set())}
          >
            取消选择
          </button>
          <button
            type="button"
            className="ui-btn ui-btn-default"
            disabled={!selectedBooks.length}
            onClick={() => setBatchConfirm(true)}
          >
            移除所选…
          </button>
        </div>
      )}
      <ReaderSheet
        open={batchConfirm}
        labelId="reader-batch-remove-title"
        onClose={() => setBatchConfirm(false)}
      >
        <section className="reader-mobile-sheet reader-data-sheet">
          <header className="reader-data-heading">
            <h2 id="reader-batch-remove-title">移除 {selectedBooks.length} 本读物？</h2>
            <button
              type="button"
              className="ui-btn ui-icon-btn ui-btn-ghost ui-btn-lg"
              aria-label="关闭批量移除"
              onClick={() => setBatchConfirm(false)}
            >
              <X className="reader-icon" />
            </button>
          </header>
          <p>将从本机书库移除以下读物，以及它们的阅读进度、书签和笔记。</p>
          <ul className="reader-batch-remove-list">
            {selectedBooks.map((book) => (
              <li key={book.id}>{book.title}</li>
            ))}
          </ul>
          <div className="reader-data-actions">
            <button
              type="button"
              className="ui-btn ui-btn-lg ui-btn-default"
              onClick={() => setBatchConfirm(false)}
            >
              取消
            </button>
            <button
              type="button"
              className="ui-btn ui-btn-lg ui-btn-primary"
              disabled={!selectedBooks.length}
              onClick={() => {
                for (const book of selectedBooks) props.runtime.indexSession?.removeBook(book.id);
                reader.removeBooks(selectedBooks.map((book) => book.id));
                void persistReaderSnapshot(props.runtime, { durableLibrary: true });
                setSelected(new Set());
                setBatchConfirm(false);
              }}
            >
              确认移除所选读物
            </button>
          </div>
        </section>
      </ReaderSheet>
      <div className="reader-library-list">
        {sortedLibrary.map((book) => (
          <ReaderLibraryBook
            key={book.id}
            book={book}
            active={book.id === activeBookId}
            progress={progressByBook[book.id]?.percentage ?? 0}
            full={full}
            managing={managing}
            selected={selected.has(book.id)}
            onSelect={() => toggleSelection(book.id)}
            onOpen={() => openBook(book.id)}
            missingSource={missingSource(book)}
            menuOpen={context?.id === book.id}
            onMenu={(trigger, x, y) => setContext({ id: book.id, trigger, x, y })}
            onRename={(trigger) => showBookDialog(book.id, "rename", trigger)}
          />
        ))}
        {sortedLibrary.length === 0 && (
          <div className="reader-library-empty" role="status">
            <strong>
              {titleFilter.trim()
                ? `未找到与「${titleFilter.trim().slice(0, 30)}」匹配的读物`
                : "此分类还没有读物。"}
            </strong>
            {titleFilter && (
              <button
                type="button"
                className="ui-btn ui-btn-ghost ui-btn-sm"
                onClick={() => {
                  setTitleFilter("");
                  searchInput.current?.focus();
                }}
              >
                清除搜索
              </button>
            )}
          </div>
        )}
      </div>
      {context && menuBook && (
        <ContextMenu
          key={context.id}
          label="读物操作"
          title={menuBook.title}
          x={context.x}
          y={context.y}
          trigger={context.trigger}
          actions={menuActions}
          onClose={() => setContext(null)}
        />
      )}
      <ReaderLibraryBookDialog
        book={dialogBook}
        requestId={bookDialog?.sequence ?? 0}
        mode={bookDialog?.mode ?? "details"}
        progress={dialogBook ? (progressByBook[dialogBook.id]?.percentage ?? 0) : 0}
        missingSource={dialogBook ? missingSource(dialogBook) : false}
        onClose={() => setBookDialog(null)}
        fallbackFocus={() => searchInput.current}
        onRemove={(id) => {
          props.runtime.indexSession?.removeBook(id);
          reader.removeBook(id);
          void persistReaderSnapshot(props.runtime, { durableLibrary: true });
        }}
      />
      {!full && (
        <ReaderSheet
          open={managerOpen}
          onClose={() => setManagerOpen(false)}
          labelId="reader-library-manager-title"
          className="reader-library-manager-layer"
        >
          <section className="reader-library-manager">
            <LibraryPanel
              mode="manage"
              runtime={props.runtime}
              onImport={props.onImport}
              onClose={() => setManagerOpen(false)}
            />
          </section>
        </ReaderSheet>
      )}
    </div>
  );
}

type LibrarySortMode = "recent" | "title" | "progress" | "imported" | "favorite";
