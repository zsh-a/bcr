import { EMPTY_DISPLAY_NAMES, mergeDisplayNames } from "@bcr/market-data/research/display-names";
import { useMemo, type ReactNode } from "react";
import { NamesProvider, useNames } from "../../data/ResearchNames";
import type { SelectedRun } from "../../session/model";
import { ResearchInspection } from "./ResearchInspection";

/** Every result surface gets the same run-scoped selection and frozen display names. */
export function RunInspection({
  selected,
  children,
}: {
  selected: SelectedRun;
  children: ReactNode;
}) {
  const inherited = useNames();
  const frozen = selected.dataset.manifest.displayNames ?? EMPTY_DISPLAY_NAMES;
  const names = useMemo(() => mergeDisplayNames(frozen, inherited), [frozen, inherited]);
  return (
    <NamesProvider names={names}>
      <ResearchInspection key={selected.run.id} selected={selected}>
        {children}
      </ResearchInspection>
    </NamesProvider>
  );
}
