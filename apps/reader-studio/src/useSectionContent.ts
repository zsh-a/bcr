import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { ReaderSection } from "@bcr/reader-core";
import { loadSectionContent, subscribeSectionContent, sectionContentReady } from "./readerContent";

export function useSectionContent(section: ReaderSection | undefined, enabled = true) {
  const sections = useMemo(() => (enabled && section ? [section] : []), [section, enabled]);
  return useSectionsContent(sections);
}

export function useSectionsContent(sections: readonly ReaderSection[]) {
  const subscribe = useCallback(
    (listener: () => void) => {
      const subscriptions = sections.map((section) => subscribeSectionContent(section, listener));
      return () => subscriptions.forEach((unsubscribe) => unsubscribe());
    },
    [sections],
  );
  const snapshot = useCallback(() => sections.every(sectionContentReady), [sections]);
  const ready = useSyncExternalStore(subscribe, snapshot, snapshot);
  const [failure, setFailure] = useState<{
    sections: readonly ReaderSection[];
    message: string;
  } | null>(null);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!sections.length || ready) return;
    let cancelled = false;
    void Promise.all(sections.map(loadSectionContent)).catch((reason: unknown) => {
      if (!cancelled)
        setFailure({
          sections,
          message: reason instanceof Error ? reason.message : "正文加载失败",
        });
    });
    return () => {
      cancelled = true;
    };
  }, [sections, ready, retry]);
  return {
    ready,
    error: failure !== null && failure.sections === sections ? failure.message : null,
    retry: () => {
      setFailure(null);
      setRetry((value) => value + 1);
    },
  };
}
