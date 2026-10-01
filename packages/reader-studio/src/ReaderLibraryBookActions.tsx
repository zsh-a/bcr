import { MoreHorizontal, Star, Trash2, X } from "lucide-react";
import { useId, useState } from "react";
import type { ReaderBook } from "@bcr/reader-core";
import { ReaderSheet } from "./ReaderSheet";
import { reader } from "./store";

export function ReaderLibraryBookActions(props: {
  book: ReaderBook;
  favorite: boolean;
  onRemove: () => void;
}) {
  const labelId = useId();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(props.book.title);
  return (
    <>
      <button
        type="button"
        className="reader-book-actions"
        aria-label={`管理 ${props.book.title}`}
        title="管理读物"
        onClick={() => {
          setTitle(props.book.title);
          setOpen(true);
        }}
      >
        <MoreHorizontal className="reader-icon" />
      </button>
      <ReaderSheet open={open} onClose={() => setOpen(false)} labelId={labelId}>
        <section className="reader-mobile-sheet reader-data-sheet">
          <header className="reader-data-heading">
            <h2 id={labelId}>管理读物</h2>
            <button
              type="button"
              className="ui-btn ui-icon-btn ui-btn-ghost ui-btn-lg"
              aria-label="关闭读物管理"
              onClick={() => setOpen(false)}
            >
              <X className="reader-icon" />
            </button>
          </header>
          <button
            type="button"
            className="ui-btn ui-btn-lg ui-btn-default"
            aria-pressed={props.favorite}
            onClick={() => reader.toggleFavorite(props.book.id)}
          >
            <Star className="reader-icon" fill={props.favorite ? "currentColor" : "none"} />
            {props.favorite ? "取消收藏" : "收藏读物"}
          </button>
          <form
            className="reader-book-title-form"
            onSubmit={(event) => {
              event.preventDefault();
              if (!title.trim()) return;
              reader.renameBook(props.book.id, title);
              setOpen(false);
            }}
          >
            <label>
              读物名称
              <input
                autoFocus
                aria-label="读物名称"
                maxLength={300}
                value={title}
                onChange={(event) => setTitle(event.target.value)}
              />
            </label>
            <button
              type="submit"
              className="ui-btn ui-btn-lg ui-btn-primary"
              disabled={!title.trim() || title.trim() === props.book.title}
            >
              保存名称
            </button>
          </form>
          <button
            type="button"
            className="ui-btn ui-btn-lg ui-btn-default"
            onClick={() => {
              setOpen(false);
              props.onRemove();
            }}
          >
            <Trash2 className="reader-icon" />
            移除读物…
          </button>
        </section>
      </ReaderSheet>
    </>
  );
}
