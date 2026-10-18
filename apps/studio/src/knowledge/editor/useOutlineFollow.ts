import { useEffect, useState, type RefObject } from "react";
import { EditorView } from "@codemirror/view";
import type { NoteHeading } from "../notes/markdownAnalysis";

/** Source positions remain stable when presentation hides prefixes or headings share text. */
export function useOutlineFollow(
  host: RefObject<HTMLElement | null>,
  headings: readonly NoteHeading[],
  body: string,
  mode: "edit" | "source" | "read",
) {
  const [current, setCurrent] = useState<number | null>(null);
  useEffect(() => {
    const scope = host.current?.closest(".knowledge-document");
    if (!scope || !headings.length) {
      setCurrent(null);
      return;
    }
    let frame = 0;
    const update = () => {
      frame = 0;
      const seen: { from: number; top: number }[] = [];
      const editor = scope.querySelector<HTMLElement>(".cm-editor");
      const view = editor && editor.getClientRects().length ? EditorView.findFromDOM(editor) : null;
      if (mode !== "read" && view) {
        // Deferred outline analysis must never address offsets from an older document.
        if (view.state.doc.toString() !== body) return;
        for (const heading of headings)
          seen.push({
            from: heading.from,
            top: view.documentTop + view.lineBlockAt(heading.from).top,
          });
      } else {
        for (const node of scope.querySelectorAll('[id^="note-heading-"]')) {
          if (!node.getClientRects().length) continue;
          const from = Number(node.id.slice("note-heading-".length));
          if (Number.isFinite(from)) seen.push({ from, top: node.getBoundingClientRect().top });
        }
      }
      const limit = window.innerHeight * 0.3;
      const above = seen.filter((item) => item.top <= limit);
      const active = above.length
        ? above.reduce((best, item) => (item.top >= best.top ? item : best))
        : seen.reduce<(typeof seen)[number] | null>(
            (best, item) => (!best || item.top < best.top ? item : best),
            null,
          );
      setCurrent(active?.from ?? null);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    const resize = new ResizeObserver(schedule);
    resize.observe(scope);
    const content = scope.querySelector(".cm-content");
    if (content) resize.observe(content);
    schedule();
    document.addEventListener("scroll", schedule, { capture: true, passive: true });
    document.addEventListener("selectionchange", schedule);
    window.addEventListener("resize", schedule);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      resize.disconnect();
      document.removeEventListener("scroll", schedule, true);
      document.removeEventListener("selectionchange", schedule);
      window.removeEventListener("resize", schedule);
    };
  }, [host, headings, body, mode]);
  return current;
}
