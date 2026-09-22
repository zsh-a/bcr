import { citationFromParams } from "@bcr/core";
import { NavigationProvider, type NavigationService, type NavigationSnapshot } from "@bcr/react";
import { useRouter } from "@tanstack/react-router";
import { useMemo, type ReactNode } from "react";

/** Router owns location. Domain views consume the same contract in embedded and standalone mode. */
export function NavigationBridge({ children }: { children: ReactNode }) {
  const router = useRouter();
  const service = useMemo<NavigationService>(() => {
    let revision = 0;
    const listeners = new Set<() => void>();
    let unsubscribe: (() => void) | undefined;
    let location = router.state.location;
    let snapshot: NavigationSnapshot = {
      pathname: location.pathname,
      search: location.searchStr,
      revision,
    };
    const read = () => {
      if (location !== router.state.location || snapshot.revision !== revision) {
        location = router.state.location;
        snapshot = { pathname: location.pathname, search: location.searchStr, revision };
      }
      return snapshot;
    };
    return {
      getSnapshot: read,
      subscribe: (listener) => {
        if (!unsubscribe)
          unsubscribe = router.subscribe("onResolved", () => {
            revision += 1;
            for (const notify of listeners) notify();
          });
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
          if (listeners.size === 0) {
            unsubscribe?.();
            unsubscribe = undefined;
          }
        };
      },
      navigate(url, replace = false) {
        const target = new URL(url, window.location.origin);
        if (target.origin !== window.location.origin) throw new Error("工作区导航仅支持站内地址");
        const search: Record<string, unknown> = Object.fromEntries(target.searchParams);
        if (target.searchParams.has("cite"))
          search.cite = citationFromParams(target.searchParams) ?? "invalid";
        for (const key of ["start", "end", "time"]) {
          const value = search[key];
          if (typeof value === "string" && value.trim() && Number.isFinite(Number(value)))
            search[key] = Number(value);
        }
        void router.navigate({ to: target.pathname as never, search: search as never, replace });
      },
    };
  }, [router]);
  return <NavigationProvider service={service}>{children}</NavigationProvider>;
}
