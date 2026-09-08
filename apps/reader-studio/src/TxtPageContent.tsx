import { memo, useMemo } from "react";
import { highlightText } from "./searchHighlight";
import type { TxtPageSpread } from "./useTxtPageFlow";
import type { TxtPageFragment } from "./txtPageLayout";

export const TxtPageContent = memo(function TxtPageContent({
  spreads,
  query,
}: {
  spreads: readonly TxtPageSpread[];
  query: string;
}) {
  return spreads.map((spread) => (
    <div className="reader-txt-spread" key={`${spread.start.section}:${spread.start.offset}`}>
      {spread.pages.map((page) => (
        <div
          className="reader-txt-page"
          key={`${page.start.section}:${page.start.offset}`}
          data-txt-page-start={`${page.start.section}:${page.start.offset}`}
          data-txt-page-end={`${page.end.section}:${page.end.offset}`}
        >
          {page.fragments.map((fragment) => (
            <TxtFragment
              key={`${fragment.section.id}:${fragment.start}`}
              fragment={fragment}
              source={query ? fragment.section.text : ""}
              query={query}
            />
          ))}
        </div>
      ))}
    </div>
  ));
});
const TxtFragment = memo(function TxtFragment({
  fragment,
  source,
  query,
}: {
  fragment: TxtPageFragment;
  source: string;
  query: string;
}) {
  const text = useMemo(
    () =>
      source
        ? highlightText(source, query, fragment.start, fragment.end)
        : highlightText(fragment.text, query),
    [source, fragment.text, fragment.start, fragment.end, query],
  );
  return (
    <section
      className="reader-section"
      data-reader-section={fragment.section.id}
      data-reader-section-index={fragment.section.order}
      data-reader-content-ready="true"
      style={{ paddingTop: fragment.gap }}
    >
      <div className="reader-section-body">
        <p
          className="reader-prose"
          data-reader-text-start={fragment.start}
          data-reader-text-end={fragment.end}
          data-reader-text-length={fragment.total}
          role={fragment.heading ? "heading" : undefined}
          aria-level={fragment.heading ? 2 : undefined}
          style={{
            textIndent: fragment.start > 0 || fragment.heading ? 0 : undefined,
            fontWeight: fragment.heading ? 600 : undefined,
            textAlign: fragment.heading ? "start" : "justify",
            textAlignLast: fragment.end < fragment.total ? "justify" : "auto",
          }}
        >
          {text}
        </p>
      </div>
    </section>
  );
});
