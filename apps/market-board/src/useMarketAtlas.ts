import { createDemoSnapshot, type MarketAtlasSnapshot } from "@bcr/market-data";
import { useRuntimeActivity } from "@bcr/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { atlasService } from "./marketServices";

const REFRESH_MS = 60_000;

export interface MarketAtlasResource {
  readonly snapshot: MarketAtlasSnapshot;
  readonly refreshing: boolean;
  readonly refresh: () => Promise<void>;
}

export function useMarketAtlas(): MarketAtlasResource {
  const active = useRuntimeActivity();
  const [snapshot, setSnapshot] = useState<MarketAtlasSnapshot>(() => createDemoSnapshot());
  const [refreshing, setRefreshing] = useState(true);
  const request = useRef(0);
  const receivedAt = useRef(snapshot.receivedAt);

  const refresh = useCallback(async () => {
    const current = ++request.current;
    setRefreshing(true);
    const next = await atlasService.load();
    if (current === request.current) {
      receivedAt.current = next.receivedAt;
      setSnapshot(next);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    if (!active) return;
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
  }, [refresh, active]);

  return { snapshot, refreshing, refresh };
}
