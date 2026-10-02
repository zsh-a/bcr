import { useLayoutEffect, useRef, useState } from "react";
import { defaultRangeExtractor, useVirtualizer } from "@tanstack/react-virtual";
import { FileText } from "lucide-react";
import type { KnowledgeNote } from "../session/model";
import { noteSearchHit } from "../search/retrieval";
import { notePath } from "../notes/paths";
import { noteWhen } from "../editor/format";

/** Search and recent views preserve their incoming order rather than re-sorting a folder tree. */
export function NoteResults({
  notes,
  activeId,
  query,
  onSelect,
  onOpen,
}: {
  notes: readonly KnowledgeNote[];
  activeId?: string | undefined;
  query: string;
  onSelect: (id: string) => void;
  onOpen: (id: string) => void;
}) {
  const scroll = useRef<HTMLDivElement>(null);
  const [focusIndex, setFocusIndex] = useState<number | null>(null);
  const selectedIndex = Math.max(
    0,
    notes.findIndex((note) => note.id === activeId),
  );
  const focused = focusIndex === null ? selectedIndex : Math.min(focusIndex, notes.length - 1);
  const virtualizer = useVirtualizer({
    count: notes.length,
    getScrollElement: () => scroll.current,
    estimateSize: () => (query.trim() ? 78 : 62),
    getItemKey: (index) => notes[index]!.id,
    overscan: 5,
    rangeExtractor: (range) =>
      [...new Set([...defaultRangeExtractor(range), focused])]
        .filter((index) => index >= 0 && index < notes.length)
        .sort((a, b) => a - b),
  });
  useLayoutEffect(() => {
    scroll.current?.scrollTo({ top: 0 });
    setFocusIndex(null);
  }, [query]);
  useLayoutEffect(() => {
    if (focusIndex === null) return;
    scroll.current
      ?.querySelector<HTMLButtonElement>(`[data-result-index="${focused}"]`)
      ?.focus({ preventScroll: true });
  }, [focusIndex, focused]);
  return (
    <div ref={scroll} className="knowledge-result-list">
      <ul style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
        {virtualizer.getVirtualItems().map((row) => {
          const note = notes[row.index]!;
          const hit = query.trim() ? noteSearchHit(note, query) : null;
          const start = hit?.match ? Math.max(hit.previewRange.start, hit.match.start - 18) : 0;
          const excerpt = hit ? note.body.slice(start, start + 100) : "";
          const matchStart = hit?.match ? hit.match.start - start : -1;
          const matchEnd = hit?.match ? hit.match.end - start : -1;
          return (
            <li
              key={note.id}
              style={{
                position: "absolute",
                insetInline: 0,
                top: 0,
                height: row.size,
                transform: `translateY(${row.start}px)`,
              }}
            >
              <button
                type="button"
                className="knowledge-result"
                data-result-index={row.index}
                aria-label={note.title || "未命名笔记"}
                aria-description={excerpt || notePath(note)}
                aria-current={activeId === note.id ? "page" : undefined}
                tabIndex={row.index === focused ? 0 : -1}
                title={notePath(note)}
                onClick={() => onSelect(note.id)}
                onDoubleClick={() => onOpen(note.id)}
                onKeyDown={(event) => {
                  if (event.nativeEvent.isComposing) return;
                  if (event.key === "Enter") {
                    event.preventDefault();
                    onOpen(note.id);
                    return;
                  }
                  if (!["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
                  event.preventDefault();
                  const next =
                    event.key === "Home"
                      ? 0
                      : event.key === "End"
                        ? notes.length - 1
                        : Math.max(
                            0,
                            Math.min(
                              notes.length - 1,
                              row.index + (event.key === "ArrowDown" ? 1 : -1),
                            ),
                          );
                  virtualizer.scrollToIndex(next, { align: "auto" });
                  setFocusIndex(next);
                }}
              >
                <FileText size={15} aria-hidden="true" />
                <span className="knowledge-result-copy">
                  <span className="knowledge-result-title">{note.title || "未命名笔记"}</span>
                  {excerpt && (
                    <span className="knowledge-result-preview">
                      {matchStart >= 0 ? (
                        <>
                          {excerpt.slice(0, matchStart)}
                          <mark>{excerpt.slice(matchStart, matchEnd)}</mark>
                          {excerpt.slice(matchEnd)}
                        </>
                      ) : (
                        excerpt
                      )}
                    </span>
                  )}
                  <span className="knowledge-result-meta">
                    <span>{parentFolder(note)}</span>
                    <time dateTime={new Date(note.updatedAt).toISOString()}>
                      {noteWhen(note.updatedAt)}
                    </time>
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function parentFolder(note: KnowledgeNote) {
  const parts = notePath(note).split("/");
  return parts.length > 1 ? parts.slice(0, -1).join(" / ") : "库根";
}
