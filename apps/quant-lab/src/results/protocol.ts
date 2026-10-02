import type { BenchmarkBinding } from "@bcr/market-data/research/benchmark";
import type { ResearchDataset, SnapshotPartitionRange } from "@bcr/market-data/research/model";
import type { OrderFilter, ResultSource } from "./result-data";

export type ResultRequest =
  | { id: number; type: "chart-events"; result: ResultSource; from: string; to: string }
  | {
      id: number;
      type: "chart-orders";
      result: ResultSource;
      from: string;
      to: string;
      code: string;
      offset: number;
    }
  | {
      id: number;
      type: "chart-fills";
      result: ResultSource;
      from: string;
      to: string;
      code: string;
    }
  | {
      id: number;
      type: "snapshot-bars";
      ranges?: SnapshotPartitionRange[];
      dataset: ResearchDataset;
      code: string;
      from: number;
      to: number;
    }
  | { id: number; type: "research-summary"; result: ResultSource; capital: number }
  | { id: number; type: "research-day"; result: ResultSource; date: string; offset: number }
  | { id: number; type: "breadth-history"; result: ResultSource; from: string; to: string }
  | { id: number; type: "orders"; result: ResultSource; filter: OrderFilter; offset: number }
  | { id: number; type: "curve"; result: ResultSource; from: string; to: string }
  | { id: number; type: "decision"; result: ResultSource; date: string }
  | {
      id: number;
      type: "evaluation";
      result: ResultSource;
      capital: number;
      dates: string[];
      baselineDate: string;
      benchmark?: BenchmarkBinding;
    }
  | { id: number; type: "cancel" }
  | { id: number; type: "clear" };
export type ResultResponse = { id: number; value?: unknown; error?: string; cancelled?: boolean };
