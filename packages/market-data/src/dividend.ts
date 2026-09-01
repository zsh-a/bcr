import type { DividendSeries, MarketInstrument } from "./model";

/**
 * A clearly labelled offline dividend fixture.  It is intentionally limited
 * to the curated Moutai instrument so an upstream outage never invents
 * corporate actions for an arbitrary security.
 */
export function createDemoDividendSeries(
  instrument: MarketInstrument,
  reason?: string,
): DividendSeries {
  if (instrument.id !== "CN:SSE:600519") {
    return {
      instrument,
      coverage: "empty",
      events: [],
      receivedAt: Date.now(),
      source:
        reason === undefined
          ? "BCR dividend fixture · no curated record"
          : `BCR dividend fixture · ${reason}`,
    };
  }
  return {
    instrument,
    coverage: "available",
    events: [
      {
        reportDate: "2025-12-31",
        description: "10派280.24元(含税)",
        cashPerTen: 280.24,
        dividendYield: 0.0231,
        recordDate: "2026-06-25",
        exDividendDate: "2026-06-26",
        payDate: null,
        status: "实施分配",
        eps: 65.66,
        netProfitYoy: -4.53,
      },
      {
        reportDate: "2024-12-31",
        description: "10派276.73元(含税)",
        cashPerTen: 276.73,
        dividendYield: 0.0193,
        recordDate: "2025-06-25",
        exDividendDate: "2025-06-26",
        payDate: "2025-06-26",
        status: "实施分配",
        eps: 68.58,
        netProfitYoy: 11.1,
      },
      {
        reportDate: "2023-12-31",
        description: "10派308.76元(含税)",
        cashPerTen: 308.76,
        dividendYield: 0.0188,
        recordDate: "2024-06-27",
        exDividendDate: "2024-06-28",
        payDate: "2024-06-28",
        status: "实施分配",
        eps: 59.49,
        netProfitYoy: 13.2,
      },
    ],
    receivedAt: Date.now(),
    source:
      reason === undefined
        ? "BCR deterministic dividend fixture · DEMO"
        : `BCR deterministic dividend fixture · DEMO · ${reason}`,
  };
}
