import type { RuntimeServices } from "@bcr/core";
import { useEffect, useMemo, useSyncExternalStore } from "react";
import { researchService } from "./service";

/** Views subscribe; the Quant runtime owns execution and persistence lifetime. */
export function useResearch(services: RuntimeServices) {
  const service = useMemo(() => researchService(services), [services]);
  const snapshot = useSyncExternalStore(service.subscribe, service.getSnapshot);
  useEffect(() => {
    void service.initialize();
  }, [service]);
  return { ...service.actions, ...snapshot };
}
