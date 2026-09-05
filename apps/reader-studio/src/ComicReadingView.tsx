import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Minus, Plus, Images } from "lucide-react";
import { createLocator, type ReaderBook } from "@bcr/reader-core";
import { getReaderState, reader, useReader } from "./store";
import { ReaderSheet } from "./ReaderSheet";
import { settleReaderLayout } from "./readingRestore";
import "./comic-reading.css";

export function ComicReadingView({ book }: { book: ReaderBook }) {
  const preferences = useReader((state) => state.settings.books?.[book.id]);
  const progress = useReader((state) => state.progressByBook[book.id]);
  const navigation = useReader((state) => state.navigationSequence);
  const viewport = useRef<HTMLDivElement>(null);
  const restoring = useRef(false);
  const cancelRestore = useRef<(() => void) | null>(null);
  const drag = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const [zoom, setZoom] = useState(1);
  const [thumbnails, setThumbnails] = useState(false);
  const [landscape, setLandscape] = useState(() => window.innerWidth > window.innerHeight);
  useEffect(() => {
    const resize = () => setLandscape(window.innerWidth > window.innerHeight);
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);
  const pages = useMemo(
    () =>
      book.sections.flatMap((section) => {
        if (section.imageUrl) return [{ section, index: 0, count: 1, src: section.imageUrl }];
        const document = new DOMParser().parseFromString(section.html ?? "", "text/html");
        const images = [...document.querySelectorAll<HTMLImageElement>("img[src]")];
        return images.map((image, index) => ({
          section,
          index,
          count: images.length,
          src: image.getAttribute("src") ?? "",
        }));
      }),
    [book],
  );
  const current = Math.max(
    0,
    pages.findIndex(
      (page) =>
        page.section.id === progress?.locator.sectionId &&
        page.index === (progress.locator.imageAnchor?.index ?? 0),
    ),
  );
  const page = pages[current];
  const direction = preferences?.direction ?? book.rendition?.direction ?? "ltr";
  const fit = preferences?.fit ?? "page";
  const spread = (preferences?.spread ?? book.rendition?.spread === "both") && landscape;
  const patch = (value: NonNullable<typeof preferences>) => {
    const books = getReaderState().settings.books ?? {};
    reader.setSettings({ books: { ...books, [book.id]: { ...books[book.id], ...value } } });
  };
  const go = (index: number) => {
    const target = pages[Math.max(0, Math.min(pages.length - 1, index))];
    if (!target) return;
    reader.setLocator({
      ...createLocator(target.section, target.index / target.count),
      imageAnchor: { index: target.index, x: 0.5, y: 0 },
    });
    setZoom(1);
  };
  const restore = () => {
    const root = viewport.current;
    const image = root?.querySelector("img");
    if (!root || !image) return;
    const anchor = getReaderState().progressByBook[book.id]?.locator.imageAnchor;
    restoring.current = true;
    cancelRestore.current?.();
    cancelRestore.current = settleReaderLayout(
      root,
      () => {
        const rect = image.getBoundingClientRect();
        const bounds = root.getBoundingClientRect();
        root.scrollTo({
          top: root.scrollTop + rect.top - bounds.top + rect.height * (anchor?.y ?? 0),
          left:
            root.scrollLeft +
            rect.left -
            bounds.left +
            rect.width * (anchor?.x ?? 0.5) -
            root.clientWidth / 2,
          behavior: "instant",
        });
      },
      () => {
        restoring.current = false;
      },
    );
  };
  useLayoutEffect(() => {
    restore();
    return () => cancelRestore.current?.();
  }, [current, navigation, fit, spread, zoom]);
  useEffect(() => {
    if (!viewport.current) return;
    const observer = new ResizeObserver(restore);
    observer.observe(viewport.current);
    return () => observer.disconnect();
  }, [book.id, pages.length]);
  const save = useCallback(() => {
    if (restoring.current) return;
    const root = viewport.current;
    const image = root?.querySelector("img");
    if (!root || !image || !page) return;
    const y = Math.max(
      0,
      Math.min(1, root.scrollTop / Math.max(1, image.getBoundingClientRect().height)),
    );
    const rect = image.getBoundingClientRect();
    const x = Math.max(
      0,
      Math.min(
        1,
        (root.getBoundingClientRect().left + root.clientWidth / 2 - rect.left) /
          Math.max(1, rect.width),
      ),
    );
    reader.setLocator({
      ...createLocator(page.section, (page.index + y) / page.count),
      imageAnchor: { index: page.index, x, y },
    });
  }, [book.id, page]);
  useEffect(() => {
    window.addEventListener("bcr-reader-capture-progress", save);
    return () => window.removeEventListener("bcr-reader-capture-progress", save);
  }, [save]);
  return (
    <section className="reader-comic" aria-label="漫画阅读器">
      <div className="reader-comic-controls">
        <label>
          阅读方向
          <select
            aria-label="漫画阅读方向"
            value={direction}
            onChange={(event) => patch({ direction: event.target.value as "ltr" | "rtl" })}
          >
            <option value="ltr">从左向右</option>
            <option value="rtl">从右向左</option>
          </select>
        </label>
        <label>
          画面
          <select
            aria-label="漫画画面适配"
            value={fit}
            onChange={(event) => patch({ fit: event.target.value as "page" | "width" })}
          >
            <option value="page">适合整页</option>
            <option value="width">适合宽度</option>
          </select>
        </label>
        <label>
          <input
            type="checkbox"
            checked={preferences?.spread ?? book.rendition?.spread === "both"}
            onChange={(event) => patch({ spread: event.target.checked })}
          />
          横屏双页
        </label>
        <button
          type="button"
          aria-label="缩小漫画"
          disabled={zoom <= 1}
          onClick={() => setZoom(Math.max(1, zoom - 0.5))}
        >
          <Minus size={18} />
        </button>
        <output aria-label="漫画缩放比例">{zoom * 100}%</output>
        <button
          type="button"
          aria-label="放大漫画"
          disabled={zoom >= 3}
          onClick={() => setZoom(Math.min(3, zoom + 0.5))}
        >
          <Plus size={18} />
        </button>
      </div>
      {page ? (
        <div
          ref={viewport}
          className="reader-comic-viewport"
          tabIndex={0}
          aria-label="漫画画面，方向键翻页，双击缩放"
          onDoubleClick={() => setZoom(zoom > 1 ? 1 : 2)}
          onScroll={save}
          onKeyDown={(event) => {
            if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
              event.preventDefault();
              go(
                current +
                  (event.key === "ArrowRight" ? 1 : -1) *
                    (direction === "rtl" ? -1 : 1) *
                    (spread ? 2 : 1),
              );
            }
          }}
          onPointerDown={(event) => {
            cancelRestore.current?.();
            restoring.current = false;
            if (event.pointerType !== "mouse" || zoom <= 1) return;
            event.currentTarget.setPointerCapture(event.pointerId);
            drag.current = {
              x: event.clientX,
              y: event.clientY,
              left: event.currentTarget.scrollLeft,
              top: event.currentTarget.scrollTop,
            };
          }}
          onPointerMove={(event) => {
            if (!drag.current) return;
            event.currentTarget.scrollLeft = drag.current.left + drag.current.x - event.clientX;
            event.currentTarget.scrollTop = drag.current.top + drag.current.y - event.clientY;
          }}
          onPointerUp={() => {
            drag.current = null;
          }}
          onPointerCancel={() => {
            drag.current = null;
          }}
          onWheel={() => {
            cancelRestore.current?.();
            restoring.current = false;
          }}
        >
          <div
            className={`reader-comic-pages reader-comic-fit-${fit}`}
            style={{ width: `${zoom * 100}%`, direction }}
          >
            {pages.slice(current, current + (spread ? 2 : 1)).map((item, offset) => (
              <img
                key={`${item.section.id}:${item.index}`}
                src={item.src}
                alt={`第 ${current + offset + 1} 页 · ${item.section.label}`}
                draggable={false}
                style={
                  fit === "page" ? { maxHeight: `calc((100dvh - 260px) * ${zoom})` } : undefined
                }
                onLoad={restore}
              />
            ))}
          </div>
        </div>
      ) : (
        <p>
          这本读物没有可单独浏览的图片。
          <button type="button" onClick={() => patch({ comic: false })}>
            返回正文阅读
          </button>
        </p>
      )}
      <nav className="reader-comic-controls" aria-label="漫画翻页">
        <button
          type="button"
          disabled={current === 0}
          onClick={() => go(current - (spread ? 2 : 1))}
        >
          <ChevronLeft size={18} />
          上一页
        </button>
        <button type="button" onClick={() => setThumbnails(true)}>
          <Images size={18} />
          {current + 1} / {pages.length} 页
        </button>
        <button
          type="button"
          disabled={current >= pages.length - 1}
          onClick={() => go(current + (spread ? 2 : 1))}
        >
          下一页
          <ChevronRight size={18} />
        </button>
      </nav>
      {page && current === pages.length - 1 && (
        <button
          type="button"
          onClick={() =>
            reader.setLocator({
              ...createLocator(page.section, 1),
              imageAnchor: { index: page.index, x: 0.5, y: 1 },
            })
          }
        >
          标记为已读完
        </button>
      )}
      {thumbnails && (
        <ReaderSheet labelId="reader-comic-pages-title" onClose={() => setThumbnails(false)}>
          <section className="reader-mobile-sheet">
            <h2 id="reader-comic-pages-title">浏览漫画页</h2>
            <label>
              跳到页码
              <input
                type="number"
                min={1}
                max={pages.length}
                defaultValue={current + 1}
                onChange={(event) => {
                  const value = Number(event.target.value);
                  if (Number.isInteger(value) && value >= 1 && value <= pages.length) go(value - 1);
                }}
              />
            </label>
            <div className="reader-comic-thumbnails">
              {pages.slice(Math.max(0, current - 8), current + 9).map((item, offset) => {
                const index = Math.max(0, current - 8) + offset;
                return (
                  <button
                    type="button"
                    key={index}
                    aria-label={`前往漫画第 ${index + 1} 页`}
                    aria-current={index === current ? "page" : undefined}
                    onClick={() => {
                      go(index);
                      setThumbnails(false);
                    }}
                  >
                    <img src={item.src} alt="" loading="lazy" />
                    <span>{index + 1}</span>
                  </button>
                );
              })}
            </div>
            <button type="button" onClick={() => setThumbnails(false)}>
              返回阅读
            </button>
          </section>
        </ReaderSheet>
      )}
    </section>
  );
}
