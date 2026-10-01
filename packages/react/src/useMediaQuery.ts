import { useMemo, useSyncExternalStore } from "react";

/** React owns responsive panel mounting; CSS still owns presentation. */
export function useMediaQuery(query: string): boolean {
  const media = useMemo(
    () => (typeof window === "undefined" ? null : window.matchMedia(query)),
    [query],
  );
  return useSyncExternalStore(
    (listener) => {
      media?.addEventListener("change", listener);
      return () => media?.removeEventListener("change", listener);
    },
    () => media?.matches ?? false,
    () => false,
  );
}
