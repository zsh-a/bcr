import { defaultRangeExtractor, useVirtualizer } from "@tanstack/react-virtual";
import { useCallback, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import type { ReaderBook } from "@bcr/reader-core";
import { SectionView } from "./SectionView";

export const SECTION_WINDOW_THRESHOLD = 200;

/** Keep the navigation target mounted so locator restoration can measure it. */
export function VirtualPublicationSections(props: {
  book: ReaderBook;
  activeSectionId: string | null;
  searchQuery: string;
  scrollRef: RefObject<HTMLDivElement | null>;
  typographyKey: string;
}) {
  const root = useRef<HTMLDivElement>(null);
  const [scrollMargin, setScrollMargin] = useState(0);
  const indexes = useMemo(
    () => new Map(props.book.sections.map((section, index) => [section.id, index])),
    [props.book.sections],
  );
  const activeIndex = indexes.get(props.activeSectionId ?? "") ?? 0;
  const getItemKey = useCallback(
    (index: number) => props.book.sections[index]!.id,
    [props.book.sections],
  );
  const virtualizer = useVirtualizer({
    count: props.book.sections.length,
    getScrollElement: () => props.scrollRef.current,
    estimateSize: () => 360,
    getItemKey,
    overscan: 5,
    scrollMargin,
    useAnimationFrameWithResizeObserver: true,
    rangeExtractor: useCallback(
      (range: Parameters<typeof defaultRangeExtractor>[0]) =>
        [...new Set([...defaultRangeExtractor(range), activeIndex])].sort((a, b) => a - b),
      [activeIndex],
    ),
  });
  useLayoutEffect(() => {
    const element = root.current;
    const scroll = props.scrollRef.current;
    if (!element || !scroll) return;
    let width = -1;
    const measure = () => {
      setScrollMargin(
        element.getBoundingClientRect().top - scroll.getBoundingClientRect().top + scroll.scrollTop,
      );
      if (width !== element.clientWidth) {
        width = element.clientWidth;
        virtualizer.measure();
      }
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(scroll);
    return () => observer.disconnect();
  }, [virtualizer, props.scrollRef, props.typographyKey]);
  return (
    <div
      ref={root}
      className="reader-virtual-text"
      style={{ position: "relative", height: virtualizer.getTotalSize() }}
    >
      {virtualizer.getVirtualItems().map((item) => {
        const section = props.book.sections[item.index]!;
        return (
          <div
            key={item.key}
            data-index={item.index}
            ref={virtualizer.measureElement}
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: "100%",
              display: "flow-root",
              transform: `translateY(${item.start - scrollMargin}px)`,
            }}
          >
            <SectionView
              section={section}
              virtualized
              active={section.id === props.activeSectionId}
              searchQuery={section.id === props.activeSectionId ? props.searchQuery : ""}
            />
          </div>
        );
      })}
    </div>
  );
}
