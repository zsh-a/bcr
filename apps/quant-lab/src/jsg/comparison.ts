import { canonicalConfig, type ResearchRun } from "./session";
import { CONFIG_LABELS, formatConfigValue } from "./draft";

export const MAX_COMPARISONS = 4;
export const COMPARISON_COLORS = ["info", "amber", "success", "faint"] as const;
export function compatibleRun(selected: ResearchRun, other: ResearchRun) {
  return (
    selected.id !== other.id &&
    selected.startDate === other.startDate &&
    selected.endDate === other.endDate
  );
}
export function parameterDifferences(runs: ResearchRun[]) {
  const configs = runs.map((run) => canonicalConfig(run.config));
  if (!configs.length) return [];
  return (Object.keys(configs[0]!) as (keyof (typeof configs)[number])[])
    .filter((key) =>
      configs.some((config) => JSON.stringify(config[key]) !== JSON.stringify(configs[0]![key])),
    )
    .map((key) => ({
      key,
      label: CONFIG_LABELS[key] ?? key,
      values: configs.map((config) => formatConfigValue(config, key)),
    }));
}
