import {
  Archive,
  Check,
  ChevronRight,
  LibraryBig,
  PanelLeftClose,
  Plus,
  Star,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { lazy, Suspense, useRef, useState } from "react";
import { readerAcceptAttribute, type ReaderBook } from "@bcr/reader-core";
import { readingStatus, type ReaderReadingStatus } from "./model";
import { formatBadge, formatBytes, percent, sourceIcon } from "./readerPresentation";
import type { ReaderRuntime } from "./runtime";
import { reader, useReader } from "./store";
import { persistReaderSnapshot } from "./useReaderRuntime";
import { ReaderSheet } from "./ReaderSheet";
import { ReaderLibraryBookActions } from "./ReaderLibraryBookActions";
const ReaderBackupPanel = lazy(() =>
  import("./ReaderBackupPanel").then((module) => ({ default: module.ReaderBackupPanel })),
);

export function LibraryPanel(props: {
  runtime: ReaderRuntime;
  onImport: (files: ReadonlyArray<File>) => void;
  mode?: "quick" | "manage";
  onClose?: () => void;
}) {
  const library = useReader((state) => state.library);
  const activeBookId = useReader((state) => state.activeBookId);
  const progressByBook = useReader((state) => state.progressByBook);
  const fileInput = useRef<HTMLInputElement>(null);
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
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [backupOpen, setBackupOpen] = useState(false);
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
        <button
          type="button"
          className="ui-btn ui-icon-btn ui-btn-ghost"
          onClick={() => (full ? props.onClose?.() : reader.toggleSidebar())}
          aria-label={full ? "关闭书库管理" : "收起书库"}
        >
          {full ? <X className="reader-icon" /> : <PanelLeftClose className="reader-icon" />}
        </button>
      </div>
      <input
        className="reader-library-filter"
        type="search"
        aria-label="筛选书名或作者"
        placeholder="筛选书名或作者…"
        value={titleFilter}
        onChange={(event) => setTitleFilter(event.target.value)}
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
                setConfirmingId(null);
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
        className="ui-sr-only"
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
          <LibraryBookCard
            key={book.id}
            book={book}
            active={book.id === activeBookId}
            progress={progressByBook[book.id]?.percentage ?? 0}
            favorite={book.favorite ?? false}
            managing={managing}
            selected={selected.has(book.id)}
            onSelect={() => toggleSelection(book.id)}
            onOpen={() => props.onClose?.()}
            missingSource={
              Boolean(sourceErrors[book.id]) ||
              (book.source.format === "pdf" && !book.source.ref && !book.source.objectUrl)
            }
            confirming={confirmingId === book.id}
            onRemove={() => setConfirmingId(book.id)}
            onConfirmRemove={() => {
              props.runtime.indexSession?.removeBook(book.id);
              reader.removeBook(book.id);
              void persistReaderSnapshot(props.runtime, { durableLibrary: true });
              setConfirmingId(null);
            }}
            onCancelRemove={() => setConfirmingId(null)}
          />
        ))}
        {sortedLibrary.length === 0 && <p role="status">此分类还没有读物。</p>}
      </div>
      <div className="reader-sidebar-footer">
        {!full && (
          <button
            type="button"
            className="ui-btn ui-btn-ghost"
            onClick={() => setManagerOpen(true)}
          >
            <LibraryBig className="reader-icon" /> 管理书库
          </button>
        )}
        <button type="button" className="ui-btn ui-btn-ghost" onClick={() => setBackupOpen(true)}>
          <Archive className="reader-icon" /> 备份与恢复
        </button>
      </div>
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

function LibraryBookCard(props: {
  book: ReaderBook;
  active: boolean;
  progress: number;
  favorite: boolean;
  managing: boolean;
  selected: boolean;
  onSelect: () => void;
  onOpen: () => void;
  missingSource: boolean;
  confirming: boolean;
  onRemove: () => void;
  onConfirmRemove: () => void;
  onCancelRemove: () => void;
}) {
  return (
    <div className="reader-book-entry">
      <button
        type="button"
        className={`reader-book-card ${props.active ? "is-active" : ""} ${props.managing ? "is-managing" : ""} ${props.selected ? "is-selected" : ""}`}
        onClick={() => {
          if (props.managing) {
            props.onSelect();
            return;
          }
          reader.openBook(props.book.id);
          props.onOpen();
          if (window.matchMedia("(max-width: 860px)").matches) reader.toggleSidebar();
        }}
        aria-current={props.active ? "page" : undefined}
        aria-pressed={props.managing ? props.selected : undefined}
        aria-label={props.managing ? `选择 ${props.book.title}` : undefined}
      >
        {props.managing && (
          <span className="reader-book-selection" aria-hidden="true">
            {props.selected && <Check className="reader-icon" />}
          </span>
        )}
        <div className={`reader-book-cover reader-cover-${props.book.source.format}`}>
          {props.book.coverUrl ? (
            <img src={props.book.coverUrl} alt="" />
          ) : (
            <>
              {sourceIcon(props.book.source.format)}
              <span>{formatBadge(props.book.source.format)}</span>
            </>
          )}
        </div>
        <div className="reader-book-card-copy">
          <strong>
            {props.favorite && (
              <Star className="reader-book-favorite" fill="currentColor" aria-label="已收藏" />
            )}
            {props.book.title}
          </strong>
          {props.book.tags.includes("DEMO") && (
            <small className="reader-book-demo-hint">示例读物</small>
          )}
          {props.missingSource && <small role="status">缺少源文件 · 请重新导入</small>}
          <span>{props.book.author ?? "本地文档"}</span>
          <div className="reader-book-meta">
            <span>{formatBadge(props.book.source.format)}</span>
            <span>
              {formatBytes(props.book.source.size)} ·{" "}
              {readingStatus(props.progress) === "finished"
                ? "100% · 已读完"
                : props.progress > 0
                  ? `${percent(props.progress)} · 在读`
                  : "未读"}
            </span>
          </div>
          <div className="reader-book-progress">
            <span style={{ width: `${Math.round(props.progress * 100)}%` }} />
          </div>
        </div>
        {props.active && <ChevronRight className="reader-book-active-icon" />}
      </button>
      {!props.managing && (
        <>
          <button
            type="button"
            className="reader-book-remove"
            aria-label={`移除 ${props.book.title}`}
            onClick={props.onRemove}
          >
            <Trash2 className="reader-icon" />
          </button>
          <ReaderLibraryBookActions
            book={props.book}
            favorite={props.favorite}
            onRemove={props.onRemove}
          />
        </>
      )}
      {props.confirming && (
        <div className="reader-book-confirm" role="alert">
          <span>从本地书库移除？</span>
          <div>
            <button type="button" onClick={props.onConfirmRemove}>
              确认
            </button>
            <button type="button" onClick={props.onCancelRemove}>
              取消
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
