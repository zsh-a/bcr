import type { RuntimeServices } from "@bcr/core";
import type { TrendResult } from "@bcr/quant-core/trend";
import { useEffect, useMemo, useSyncExternalStore } from "react";
import { readJson } from "../../data/io";
import { createTrendResultLoader, selectedTrendResult, type TrendResultSelection } from "./result";

export function useTrendResult(
  artifacts: RuntimeServices["artifacts"],
  selected: TrendResultSelection | null,
) {
  const loader = useMemo(
    () => createTrendResultLoader((ref) => readJson<TrendResult>({ artifacts }, ref)),
    [artifacts],
  );
  const snapshot = useSyncExternalStore(loader.subscribe, loader.getSnapshot, loader.getSnapshot);
  useEffect(() => {
    void loader.load(selected);
    return () => loader.cancel();
  }, [loader, selected]);
  return {
    state: selectedTrendResult(snapshot, selected),
    retry: () => void loader.load(selected),
  };
}
