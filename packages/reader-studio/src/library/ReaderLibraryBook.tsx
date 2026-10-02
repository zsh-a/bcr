import { Check, Star } from "lucide-react";
import { useEffect, useRef, type MouseEvent } from "react";
import type { ReaderBook } from "@bcr/reader-core";
import { readingStatus } from "../state/model";
import { formatBadge, formatBytes, percent, sourceIcon } from "../reading/readerPresentation";

export function ReaderLibraryBook(props: {
  book: ReaderBook;
  full: boolean;
  active: boolean;
  progress: number;
  managing: boolean;
  selected: boolean;
  missingSource: boolean;
  menuOpen: boolean;
  onOpen: () => void;
  onSelect: () => void;
  onMenu: (trigger: HTMLElement, x: number, y: number) => void;
  onRename: (trigger: HTMLElement) => void;
}) {
  const hold = useRef<ReturnType<typeof setTimeout> | null>(null);
  const point = useRef({ x: 0, y: 0 });
  const suppressClick = useRef(false);
  const cancelHold = () => {
    if (hold.current !== null) clearTimeout(hold.current);
    hold.current = null;
  };
  useEffect(() => cancelHold, []);
  const openMenu = (trigger: HTMLElement) => {
    const box = trigger.getBoundingClientRect();
    props.onMenu(trigger, box.left + 16, box.top + Math.min(box.height, 44));
  };
  const progress = Math.max(0, Math.min(1, props.progress));
  const status = readingStatus(progress);
  const label = status === "finished" ? "已读完" : progress > 0 ? percent(progress) : "未读";
  const title = (
    <strong title={props.book.title}>
      {props.book.favorite && (
        <Star className="reader-book-favorite" fill="currentColor" aria-label="已收藏" />
      )}
      {props.book.title}
    </strong>
  );
  return (
    <div className="reader-book-entry" data-book-id={props.book.id}>
      <button
        type="button"
        className={`${props.full ? "reader-book-card" : "reader-book-row"} ${props.active ? "is-active" : ""} ${props.managing ? "is-managing" : ""} ${props.selected ? "is-selected" : ""}`}
        data-menu-open={props.menuOpen || undefined}
        aria-current={props.active ? "page" : undefined}
        aria-pressed={props.managing ? props.selected : undefined}
        aria-label={props.managing ? `选择 ${props.book.title}` : props.book.title}
        aria-haspopup="menu"
        aria-expanded={props.menuOpen}
        aria-description="右键或长按管理读物；键盘按 Shift+F10 打开菜单，F2 重命名"
        aria-keyshortcuts="Shift+F10 F2"
        onClick={(event: MouseEvent<HTMLButtonElement>) => {
          if (suppressClick.current && event.detail !== 0) {
            suppressClick.current = false;
            return;
          }
          if (props.managing) props.onSelect();
          else props.onOpen();
        }}
        onContextMenu={(event) => {
          event.preventDefault();
          event.stopPropagation();
          cancelHold();
          if (event.clientX === 0 && event.clientY === 0) openMenu(event.currentTarget);
          else props.onMenu(event.currentTarget, event.clientX, event.clientY);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") suppressClick.current = false;
          if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
            event.preventDefault();
            event.stopPropagation();
            openMenu(event.currentTarget);
          } else if (event.key === "F2") {
            event.preventDefault();
            event.stopPropagation();
            props.onRename(event.currentTarget);
          }
        }}
        onPointerDown={(event) => {
          cancelHold();
          suppressClick.current = false;
          if (event.pointerType === "mouse" || event.button !== 0) return;
          point.current = { x: event.clientX, y: event.clientY };
          const trigger = event.currentTarget;
          hold.current = setTimeout(() => {
            hold.current = null;
            suppressClick.current = true;
            openMenu(trigger);
          }, 500);
        }}
        onPointerMove={(event) => {
          if (Math.hypot(event.clientX - point.current.x, event.clientY - point.current.y) > 8)
            cancelHold();
        }}
        onPointerUp={cancelHold}
        onPointerCancel={cancelHold}
        onPointerLeave={cancelHold}
      >
        {props.full ? (
          <>
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
              {title}
              {props.book.author && <span>{props.book.author}</span>}
              {props.book.tags.includes("DEMO") && (
                <small className="reader-book-demo-hint">示例读物</small>
              )}
              {props.missingSource && <small role="status">缺少源文件 · 请重新导入</small>}
              <div className="reader-book-meta">
                <span>{formatBadge(props.book.source.format)}</span>
                <span>
                  {formatBytes(props.book.source.size)} · {label}
                </span>
              </div>
              <div className="reader-book-progress" aria-hidden="true">
                <span style={{ width: `${progress * 100}%` }} />
              </div>
            </div>
          </>
        ) : (
          <>
            <div className="reader-book-thumbnail" aria-hidden="true">
              {props.book.coverUrl ? (
                <img src={props.book.coverUrl} alt="" />
              ) : (
                sourceIcon(props.book.source.format)
              )}
            </div>
            <div className="reader-book-row-copy">
              {title}
              <div className="reader-book-row-caption">
                <span>
                  {props.book.author || formatBadge(props.book.source.format)}
                  {props.book.tags.includes("DEMO") ? " · 示例" : ""}
                </span>
                <span>{label}</span>
              </div>
              {props.missingSource && <small role="status">缺少源文件 · 请重新导入</small>}
              {progress > 0 && (
                <div className="reader-book-progress" aria-hidden="true">
                  <span style={{ width: `${progress * 100}%` }} />
                </div>
              )}
            </div>
          </>
        )}
      </button>
    </div>
  );
}
