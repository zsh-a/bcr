import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import type { ReaderSection } from "@bcr/reader-core";
import { loadTxtSection, subscribeTxtSection, txtSectionReady } from "./lazyTxt";

export function useTxtSection(section: ReaderSection | undefined, enabled = true) {
  const target = enabled ? section : undefined;
  const subscribe = useCallback(
    (listener: () => void) => subscribeTxtSection(target, listener),
    [target],
  );
  const snapshot = useCallback(() => txtSectionReady(target), [target]);
  const ready = useSyncExternalStore(subscribe, snapshot, snapshot);
  const [failure, setFailure] = useState<{ section: ReaderSection; message: string } | null>(null);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!target || ready) return;
    let cancelled = false;
    void loadTxtSection(target).catch((reason: unknown) => {
      if (!cancelled)
        setFailure({
          section: target,
          message: reason instanceof Error ? reason.message : "正文加载失败",
        });
    });
    return () => {
      cancelled = true;
    };
  }, [target, ready, retry]);
  return {
    ready,
    error: failure !== null && failure.section === target ? failure.message : null,
    retry: () => {
      setFailure(null);
      setRetry((value) => value + 1);
    },
  };
}
