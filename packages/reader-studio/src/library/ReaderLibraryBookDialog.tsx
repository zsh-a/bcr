import { useId, useState } from "react";
import { X } from "lucide-react";
import type { ReaderBook } from "@bcr/reader-core";
import { ReaderSheet } from "../workbench/ReaderSheet";
import { formatBadge, formatBytes, percent } from "../reading/readerPresentation";
import { reader } from "../state/store";

export type BookDialogMode = "rename" | "details" | "remove";

export function ReaderLibraryBookDialog(props: {
  book: ReaderBook | null;
  requestId: number;
  mode: BookDialogMode;
  progress: number;
  missingSource: boolean;
  onClose: () => void;
  onRemove: (id: string) => void;
  fallbackFocus: () => HTMLElement | null;
}) {
  const labelId = useId();
  const titles = { rename: "重命名读物", details: "读物详情", remove: "移除读物？" };
  return (
    <ReaderSheet
      open={props.book !== null}
      labelId={labelId}
      onClose={props.onClose}
      fallbackFocus={props.fallbackFocus}
    >
      {props.book && (
        <section className="reader-mobile-sheet reader-data-sheet reader-book-dialog">
          <header className="reader-data-heading">
            <h2 id={labelId}>{titles[props.mode]}</h2>
            <button
              type="button"
              className="ui-btn ui-icon-btn ui-btn-ghost ui-btn-lg"
              aria-label="关闭读物管理"
              onClick={props.onClose}
            >
              <X className="reader-icon" />
            </button>
          </header>
          {props.mode === "rename" ? (
            <BookTitleForm key={props.requestId} book={props.book} onClose={props.onClose} />
          ) : props.mode === "details" ? (
            <dl className="reader-book-details">
              <dt>名称</dt>
              <dd>{props.book.title}</dd>
              {props.book.author && (
                <>
                  <dt>作者</dt>
                  <dd>{props.book.author}</dd>
                </>
              )}
              <dt>源文件</dt>
              <dd>{props.book.source.name}</dd>
              <dt>格式与大小</dt>
              <dd>
                {formatBadge(props.book.source.format)} · {formatBytes(props.book.source.size)}
              </dd>
              <dt>阅读进度</dt>
              <dd>{percent(props.progress)}</dd>
              <dt>添加时间</dt>
              <dd>{new Date(props.book.importedAt).toLocaleString("zh-CN")}</dd>
              {props.missingSource && (
                <>
                  <dt>文件状态</dt>
                  <dd>缺少源文件 · 请重新导入</dd>
                </>
              )}
            </dl>
          ) : (
            <>
              <p>将从本机书库移除「{props.book.title}」，以及它的阅读进度、书签和笔记。</p>
              <div className="reader-data-actions">
                <button
                  type="button"
                  autoFocus
                  className="ui-btn ui-btn-lg ui-btn-default"
                  onClick={props.onClose}
                >
                  取消
                </button>
                <button
                  type="button"
                  className="ui-btn ui-btn-lg ui-btn-danger"
                  onClick={() => {
                    if (props.book) props.onRemove(props.book.id);
                    props.onClose();
                  }}
                >
                  确认移除读物
                </button>
              </div>
            </>
          )}
        </section>
      )}
    </ReaderSheet>
  );
}

function BookTitleForm(props: { book: ReaderBook; onClose: () => void }) {
  const [title, setTitle] = useState(props.book.title);
  return (
    <form
      className="reader-book-title-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (!title.trim()) return;
        reader.renameBook(props.book.id, title);
        props.onClose();
      }}
    >
      <label>
        读物名称
        <input
          autoFocus
          className="ui-input"
          aria-label="读物名称"
          maxLength={300}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />
      </label>
      <div className="reader-data-actions">
        <button type="button" className="ui-btn ui-btn-lg ui-btn-default" onClick={props.onClose}>
          取消
        </button>
        <button
          type="submit"
          className="ui-btn ui-btn-lg ui-btn-primary"
          disabled={!title.trim() || title.trim() === props.book.title}
        >
          保存名称
        </button>
      </div>
    </form>
  );
}
