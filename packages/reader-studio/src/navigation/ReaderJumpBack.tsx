import { ArrowLeft, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { ReaderHistoryEntry } from "../state/model";
import { reader } from "../state/store";
import { useReader } from "../state/useReader";

/** A short-lived undo shortcut; the full trail remains in the progress sheet. */
export function ReaderJumpBack() {
  const [entry, setEntry] = useState<ReaderHistoryEntry | null>(null);
  const back = useReader((state) => state.navigationHistory.back);
  const query = useReader((state) => state.query);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const remember = (event: Event) => setEntry((event as CustomEvent<ReaderHistoryEntry>).detail);
    window.addEventListener("bcr-reader-remember-position", remember);
    return () => window.removeEventListener("bcr-reader-remember-position", remember);
  }, []);
  useEffect(() => {
    if (!entry || query) return;
    const timer = window.setTimeout(() => {
      // Do not remove a control while a keyboard user is operating it.
      if (!ref.current?.contains(document.activeElement)) setEntry(null);
    }, 8000);
    return () => window.clearTimeout(timer);
  }, [entry, query]);
  if (!entry || query || back.at(-1) !== entry) return null;
  const dismiss = () => {
    setEntry(null);
    requestAnimationFrame(() =>
      document
        .querySelector<HTMLElement>('.reader-mobile-nav [aria-label="调整阅读进度"]')
        ?.focus({ preventScroll: true }),
    );
  };
  return (
    <div ref={ref} className="reader-jump-back">
      <button
        type="button"
        aria-label="返回原处"
        onClick={() => {
          dismiss();
          reader.navigateHistory("back");
        }}
      >
        <ArrowLeft className="reader-icon" />
        返回原处
      </button>
      <button type="button" aria-label="关闭返回提示" onClick={dismiss}>
        <X className="reader-icon" />
      </button>
    </div>
  );
}
