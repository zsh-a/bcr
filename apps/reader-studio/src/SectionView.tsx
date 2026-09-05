import { memo, useMemo, useEffect, useRef, useState } from "react";
import type { ReaderSection } from "@bcr/reader-core";
import { highlightHtml, highlightText } from "./searchHighlight";

/** Publication content never subscribes to scroll progress. */
export const SectionView = memo(function SectionView(props: {
  section: ReaderSection;
  searchQuery: string;
  active?: boolean;
}) {
  const root = useRef<HTMLElement>(null);
  const [visible, setVisible] = useState(props.section.order < 2 || props.active === true);
  const [height, setHeight] = useState(360);
  useEffect(() => {
    const element = root.current;
    if (!element || !window.IntersectionObserver) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry) return;
        if (!entry.isIntersecting && element.offsetHeight > 0) setHeight(element.offsetHeight);
        setVisible(entry.isIntersecting);
      },
      { root: element.closest(".reader-reading-scroll"), rootMargin: "1600px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const mounted = visible || props.active || props.searchQuery !== "";
  const html = useMemo(
    () =>
      props.section.html === undefined
        ? undefined
        : highlightHtml(props.section.html, props.searchQuery),
    [props.section.html, props.searchQuery],
  );
  const text = useMemo(
    () => (html === undefined ? highlightText(props.section.text, props.searchQuery) : null),
    [html, props.section.text, props.searchQuery],
  );
  return (
    <section
      ref={root}
      style={mounted ? undefined : { height }}
      className="reader-section"
      data-reader-section={props.section.id}
      data-reader-section-index={props.section.order}
    >
      {mounted && (
        <>
          <div className="reader-section-index">
            {String(props.section.order + 1).padStart(2, "0")}
          </div>
          <div className="reader-section-body">
            <div className="reader-section-label">{props.section.label}</div>
            {props.section.kind === "image" && props.section.imageUrl ? (
              <img
                className="reader-section-image"
                src={props.section.imageUrl}
                alt={props.section.imageAlt ?? props.section.label}
                loading="lazy"
                decoding="async"
              />
            ) : html ? (
              <div className="reader-prose" dangerouslySetInnerHTML={{ __html: html }} />
            ) : (
              <p className="reader-prose">{text}</p>
            )}
          </div>
        </>
      )}
    </section>
  );
});
