import { Check, ChevronRight } from "lucide-react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ReaderBook, ReaderTocItem } from "@bcr/reader-core";
import { currentReaderTocItem, openReaderTocItem, resolveReaderTocTarget } from "./navigation";
import { tocAncestors, visibleTocRows } from "./tocTree";

export function ReaderTocTree(props: {
  book: ReaderBook;
  items: readonly ReaderTocItem[];
  activeSectionId: string | null;
  query: string;
  collapsed: ReadonlySet<string>;
  onCollapsedChange: (ids: ReadonlySet<string>) => void;
  onNavigate: () => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const allItems = useMemo(
    () => visibleTocRows(props.items, new Set()).map((row) => row.item),
    [props.items],
  );
  const highlightedId = currentReaderTocItem(props.book, allItems, props.activeSectionId)?.id;
  const [focusIndex, setFocusIndex] = useState<{ index: number } | null>(null);
  const collapsedRef = useRef(props.collapsed);
  collapsedRef.current = props.collapsed;
  const onCollapsedChangeRef = useRef(props.onCollapsedChange);
  onCollapsedChangeRef.current = props.onCollapsedChange;
  useEffect(() => {
    if (!highlightedId) return;
    const next = new Set(collapsedRef.current);
    let changed = false;
    for (const id of tocAncestors(props.items, highlightedId)) changed = next.delete(id) || changed;
    if (changed) onCollapsedChangeRef.current(next);
  }, [highlightedId, props.items]);

  const rows = useMemo(
    () => visibleTocRows(props.items, props.collapsed, props.query),
    [props.items, props.collapsed, props.query],
  );
  const virtual = rows.length > 100;
  const virtualizer = useVirtualizer({
    count: virtual ? rows.length : 0,
    getScrollElement: () => root.current,
    estimateSize: () => 44,
    overscan: 5,
    getItemKey: (index) => rows[index]!.item.id,
  });
  const activeIndex = rows.findIndex(({ item }) => item.id === highlightedId);
  useEffect(() => {
    if (props.query) return;
    if (virtual) virtualizer.scrollToIndex(Math.max(0, activeIndex), { align: "auto" });
    else
      root.current
        ?.querySelector<HTMLElement>('[aria-current="page"]')
        ?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, props.query, virtual, virtualizer]);
  useEffect(() => {
    if (!focusIndex) return;
    if (virtual) virtualizer.scrollToIndex(focusIndex.index, { align: "auto" });
    const frame = requestAnimationFrame(() => {
      root.current
        ?.querySelector<HTMLButtonElement>(`[data-toc-index="${focusIndex.index}"]`)
        ?.focus();
      setFocusIndex(null);
    });
    return () => cancelAnimationFrame(frame);
  }, [focusIndex, virtual, virtualizer]);

  const toggle = (id: string) => {
    const next = new Set(props.collapsed);
    if (!next.delete(id)) next.add(id);
    props.onCollapsedChange(next);
  };
  const row = (index: number) => {
    const { item, depth, ordinal } = rows[index]!;
    const target = resolveReaderTocTarget(props.book, item);
    const branch = !!item.children?.length;
    const expanded = !!props.query || !props.collapsed.has(item.id);
    const active = item.id === highlightedId;
    return (
      <div
        className={`reader-toc-row ${active ? "is-active" : ""}`}
        style={{ paddingLeft: `${Math.min(depth, 8) * 16}px` }}
        role="treeitem"
        aria-level={depth + 1}
        aria-expanded={branch ? expanded : undefined}
        aria-label={item.label}
      >
        {branch ? (
          <button
            type="button"
            className="reader-toc-disclosure"
            aria-label={`${expanded ? "收起" : "展开"} ${item.label}`}
            aria-expanded={expanded}
            onClick={() => toggle(item.id)}
            disabled={!!props.query}
          >
            <ChevronRight className="reader-icon" />
          </button>
        ) : (
          <span className="reader-toc-number" aria-hidden="true">
            {String(ordinal).padStart(2, "0")}
          </span>
        )}
        <button
          type="button"
          className="reader-toc-target"
          data-toc-index={index}
          data-reader-toc-section={target?.sectionId}
          aria-current={active ? "page" : undefined}
          disabled={!target}
          title={target ? item.label : `${item.label} · 无可读正文`}
          onClick={() => {
            openReaderTocItem(props.book, item);
            props.onNavigate();
          }}
          onKeyDown={(event) => {
            if (branch && (event.key === "ArrowRight" || event.key === "ArrowLeft")) {
              event.preventDefault();
              if (!props.query && expanded !== (event.key === "ArrowRight")) toggle(item.id);
              return;
            }
            const offsets: Record<string, number> = {
              ArrowDown: index + 1,
              ArrowUp: index - 1,
              Home: 0,
              End: rows.length - 1,
              PageDown: index + 10,
              PageUp: index - 10,
            };
            const next = offsets[event.key];
            if (next !== undefined) {
              event.preventDefault();
              setFocusIndex({ index: Math.max(0, Math.min(rows.length - 1, next)) });
            }
          }}
        >
          <strong>{item.label}</strong>
          {active && <Check className="reader-icon" />}
        </button>
      </div>
    );
  };
  return (
    <div
      ref={root}
      className={`reader-toc-tree ${virtual ? "is-virtual" : ""}`}
      role="tree"
      aria-label="章节列表"
    >
      {virtual ? (
        <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
          {virtualizer.getVirtualItems().map((entry) => (
            <div
              key={entry.key}
              style={{
                position: "absolute",
                top: entry.start,
                left: 0,
                width: "100%",
                height: entry.size,
              }}
            >
              {row(entry.index)}
            </div>
          ))}
        </div>
      ) : (
        rows.map((entry, index) => <div key={entry.item.id}>{row(index)}</div>)
      )}
    </div>
  );
}
