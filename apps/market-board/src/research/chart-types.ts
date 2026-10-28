import type { EconomicTrack } from "@bcr/market-data/economy";
import type { MacroEvent } from "@bcr/market-data/macro/events";

export interface ResearchChartProps {
  tracks: EconomicTrack[];
  range: [string, string];
  baseline: number | null;
  cursorDate: string | null;
  onCursor: (date: string | null) => void;
  lockedDate?: string | null;
  onLock?: (date: string | null) => void;
  onRangeChange?: (range: [string, string]) => void;
  /** Stable country-to-colour mapping, independent of selection order. */
  colors: Record<string, string>;
  event?: MacroEvent | undefined;
  events?: MacroEvent[];
  height?: number;
  label: string;
}
