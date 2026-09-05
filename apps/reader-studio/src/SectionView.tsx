import { memo, useMemo } from "react";
import type { ReaderSection } from "@bcr/reader-core";
import { highlightHtml, highlightText } from "./searchHighlight";

/** Publication content never subscribes to scroll progress. */
export const SectionView = memo(function SectionView(props: {
  section: ReaderSection;
  searchQuery: string;
}) {
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
      className="reader-section"
      data-reader-section={props.section.id}
      data-reader-section-index={props.section.order}
    >
      <div className="reader-section-index">{String(props.section.order + 1).padStart(2, "0")}</div>
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
    </section>
  );
});
