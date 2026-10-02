import { withResearchFiles } from "@bcr/market-data/research/file-lease";
import { useRuntime } from "@bcr/react";
import { useEffect, useRef, useState } from "react";
import { compatibleRun, MAX_COMPARISONS } from "../results/comparison";
import { type SelectedRun } from "../session/model";
import { readRun } from "../session/persistence";
import type { ResearchController } from "../session/service";

export function useRunComparisons(research: ResearchController) {
  const services = useRuntime();
  const { state } = research;
  const selected = state.selected;
  const [comparisons, setComparisons] = useState<SelectedRun[]>([]);
  const [pendingComparison, setPendingComparison] = useState<string | null>(null);
  const comparing = pendingComparison !== null;
  const comparisonRequest = useRef(0);
  useEffect(
    () => () => {
      comparisonRequest.current++;
    },
    [],
  );
  useEffect(() => {
    comparisonRequest.current++;
    setPendingComparison(null);
    setComparisons((values) =>
      values.filter(
        (value) =>
          selected &&
          compatibleRun(selected.run, value.run) &&
          state.runs.some((run) => run.id === value.run.id),
      ),
    );
  }, [selected?.run.id, state.runs]);
  const compare = async (id: string) => {
    if (comparing) return;
    const request = ++comparisonRequest.current;
    if (comparisons.some((item) => item.run.id === id)) {
      setComparisons((values) => values.filter((item) => item.run.id !== id));
      return;
    }
    const run = state.runs.find((item) => item.id === id);
    if (
      !run ||
      !selected ||
      !compatibleRun(selected.run, run) ||
      comparisons.length >= MAX_COMPARISONS
    )
      return;
    setPendingComparison(id);
    try {
      const value = await withResearchFiles("shared", () => readRun(services, run));
      if (comparisonRequest.current === request) setComparisons((values) => [...values, value]);
    } catch (error) {
      if (comparisonRequest.current === request)
        research.notice(error instanceof Error ? error.message : String(error));
    } finally {
      if (comparisonRequest.current === request) setPendingComparison(null);
    }
  };
  const compatible = selected
    ? state.runs.filter(
        (run) =>
          run.id !== selected.run.id &&
          run.startDate === selected.run.startDate &&
          run.endDate === selected.run.endDate,
      )
    : [];
  return {
    comparisons,
    pendingComparison,
    comparing,
    compare,
    compatible,
    clear: () => setComparisons([]),
  };
}
export type RunComparisons = ReturnType<typeof useRunComparisons>;
