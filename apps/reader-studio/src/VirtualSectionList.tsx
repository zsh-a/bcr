import { useVirtualizer } from "@tanstack/react-virtual";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ReaderSection } from "@bcr/reader-core";

export function VirtualSectionList(props: {
  sections: readonly ReaderSection[];
  activeSectionId: string | null;
  query?: string;
  onNavigate: (id: string) => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const [focusIndex, setFocusIndex] = useState<{ index: number } | null>(null);
  const sections = useMemo(
    () =>
      props.query
        ? props.sections.filter((section) =>
            section.label.toLocaleLowerCase().includes(props.query!),
          )
        : props.sections,
    [props.sections, props.query],
  );
  const indexes = useMemo(
    () => new Map(sections.map((section, index) => [section.id, index])),
    [sections],
  );
  const activeIndex = indexes.get(props.activeSectionId ?? "") ?? -1;
  const virtualizer = useVirtualizer({
    count: sections.length,
    getScrollElement: () => root.current,
    estimateSize: () => 48,
    overscan: 4,
    getItemKey: (index) => sections[index]!.id,
  });
  useEffect(() => {
    virtualizer.scrollToIndex(Math.max(0, activeIndex), { align: "auto" });
  }, [activeIndex, sections, virtualizer]);
  useEffect(() => {
    if (focusIndex === null) return;
    virtualizer.scrollToIndex(focusIndex.index, { align: "auto" });
    const frame = requestAnimationFrame(() =>
      root.current
        ?.querySelector<HTMLButtonElement>(`[data-toc-index="${focusIndex.index}"]`)
        ?.focus(),
    );
    return () => cancelAnimationFrame(frame);
  }, [focusIndex, virtualizer]);
  return (
    <div ref={root} className="reader-virtual-toc" role="list" aria-label="章节列表">
      <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
        {virtualizer.getVirtualItems().map((item) => {
          const section = sections[item.index]!;
          return (
            <div
              key={item.key}
              role="listitem"
              aria-posinset={item.index + 1}
              aria-setsize={sections.length}
              style={{
                position: "absolute",
                top: item.start,
                left: 0,
                width: "100%",
                height: item.size,
              }}
            >
              <button
                type="button"
                data-toc-index={item.index}
                data-reader-toc-section={section.id}
                className={section.id === props.activeSectionId ? "is-active" : ""}
                aria-current={section.id === props.activeSectionId ? "page" : undefined}
                onClick={() => props.onNavigate(section.id)}
                onKeyDown={(event) => {
                  const targets: Record<string, number> = {
                    ArrowDown: item.index + 1,
                    ArrowUp: item.index - 1,
                    Home: 0,
                    End: sections.length - 1,
                    PageDown: item.index + 10,
                    PageUp: item.index - 10,
                  };
                  const target = targets[event.key];
                  if (target === undefined) return;
                  event.preventDefault();
                  setFocusIndex({ index: Math.max(0, Math.min(sections.length - 1, target)) });
                }}
              >
                <span>{String(section.order + 1).padStart(2, "0")}</span>
                <strong>{section.label}</strong>
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
