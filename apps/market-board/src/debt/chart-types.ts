import type {
  DebtFrequency,
  DebtObservation,
  DebtPhasePoint,
  DebtUnit,
} from "@bcr/market-data/debt";
import type { ChartPalette } from "../macro/chartStyle";

export type { DebtPhasePoint } from "@bcr/market-data/debt";
export interface DebtChartSeries {
  id: string;
  name: string;
  color: string;
  unit: DebtUnit;
  frequency: DebtFrequency;
  points: DebtObservation[];
}
export interface DebtStructureRow {
  country: string;
  name: string;
  household: number | null;
  corporate: number | null;
  government: number | null;
}
export interface DebtChartCountry {
  id: string;
  name: string;
  color: string;
}
export interface DebtChartProps {
  kind: "structure" | "trend" | "phase";
  palette: ChartPalette;
  countries: DebtChartCountry[];
  period: string;
  focus: string | null;
  onSelect: (id: string) => void;
  trendSeries: DebtChartSeries[];
  structure: DebtStructureRow[];
  phasePoints: DebtPhasePoint[];
}
export type DebtChartInput = Omit<DebtChartProps, "onSelect">;
