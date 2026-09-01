import { createDemoMarketLandscape, type MarketLandscapeSnapshot } from "@bcr/market-data";
import { useCallback, useEffect, useRef, useState } from "react";
import { landscapeService } from "./marketServices";

const REFRESH_MS = 120_000;

export interface MarketLandscapeResource {
  readonly snapshot: MarketLandscapeSnapshot;
  readonly refreshing: boolean;
  readonly refresh: () => Promise<void>;
}

export function useMarketLandscape(): MarketLandscapeResource {
  const [snapshot, setSnapshot] = useState<MarketLandscapeSnapshot>(() =>
    createDemoMarketLandscape(),
  );
  const [refreshing, setRefreshing] = useState(true);
  const request = useRef(0);
  const receivedAt = useRef(snapshot.receivedAt);

  const refresh = useCallback(async () => {
    const current = ++request.current;
    setRefreshing(true);
    const next = await landscapeService.load();
    if (current === request.current) {
      receivedAt.current = next.receivedAt;
      setSnapshot(next);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
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
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [refresh]);

  return { snapshot, refreshing, refresh };
}
