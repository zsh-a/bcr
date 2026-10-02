import { createDemoMarketLandscape, type MarketLandscapeSnapshot } from "@bcr/market-data";
import { useRuntimeActivity } from "@bcr/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { landscapeService } from "../data/marketServices";

const REFRESH_MS = 120_000;

export interface MarketLandscapeResource {
  readonly snapshot: MarketLandscapeSnapshot;
  readonly refreshing: boolean;
  readonly refresh: () => Promise<void>;
}

export function useMarketLandscape(enabled = true): MarketLandscapeResource {
  const active = useRuntimeActivity();
  const [snapshot, setSnapshot] = useState<MarketLandscapeSnapshot>(() =>
    createDemoMarketLandscape(),
  );
  const [refreshing, setRefreshing] = useState(true);
  const request = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const receivedAt = useRef(snapshot.receivedAt);

  const refresh = useCallback(async () => {
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    const current = ++request.current;
    setRefreshing(true);
    try {
      const next = await landscapeService.load(abort.signal);
      if (current === request.current && !abort.signal.aborted) {
        receivedAt.current = next.receivedAt;
        setSnapshot(next);
      }
    } catch (error) {
      if (!abort.signal.aborted) console.error(error);
    } finally {
      if (current === request.current) setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    if (!active || !enabled) return;
    void refresh();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, REFRESH_MS);
    const onVisibility = () => {
      if (document.visibilityState === "visible" && Date.now() - receivedAt.current > REFRESH_MS) {
        void refresh();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      request.current += 1;
      controller.current?.abort();
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [refresh, active, enabled]);

  return { snapshot, refreshing, refresh };
}
