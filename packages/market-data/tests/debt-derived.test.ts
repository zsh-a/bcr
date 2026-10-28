import { describe, expect, it } from "vitest";
import { deriveDebtCreditGrowth } from "../src/debt/derived";
import type { DebtSeries, DebtSnapshot } from "../src/debt/model";

const series: DebtSeries = {
  country: "CHN",
  indicator: "privateCreditStock",
  frequency: "Q",
  unit: "billionLocal",
  currency: "CNY",
  seasonalAdjustment: "NSA",
  valuation: "market",
  source: {
    name: "BIS",
    url: "https://data.bis.org/topics/TOTAL_CREDIT",
    seriesCode: "Q.CN.P.A.M.XDC.A",
    licenseUrl: "https://data.bis.org/help/legal",
  },
  fetchedAt: "2026-10-25T00:00:00Z",
  sourceUpdatedAt: null,
  note: "Break-adjusted local currency",
  observations: [
    { period: "2025-Q1", value: 100 },
    { period: "2025-Q2", value: 0 },
    { period: "2025-Q4", value: 150 },
    { period: "2026-Q1", value: 110, status: "P" },
    { period: "2026-Q2", value: 120 },
    { period: "2026-Q3", value: 130 },
  ],
};
const snapshot: DebtSnapshot = { version: 1, fetchedAt: series.fetchedAt, series: [series] };
describe("debt credit growth from comparable local-currency levels", () => {
  it("calculates an exact four-quarter change and identifies it as derived, retaining the source", () => {
    const derived = deriveDebtCreditGrowth(snapshot)[0]!;
    expect(derived.indicator).toBe("creditGrowth");
    expect(derived.unit).toBe("percent");
    expect(derived.currency).toBeNull();
    expect(derived.observations.find((point) => point.period === "2026-Q1")?.value).toBeCloseTo(10);
    expect(derived.observations.find((point) => point.period === "2026-Q1")?.status).toBe(
      "derived:P",
    );
    expect(derived.source.seriesCode).toContain("derived-yoy-4q");
    expect(derived.source.url).toBe(series.source.url);
    expect(derived.note).toContain("不是官方发布同比");
    expect(series.observations.find((point) => point.period === "2026-Q1")?.value).toBe(110);
  });
  it("does not use a nearest quarter or divide by zero and never derives from a debt/GDP ratio", () => {
    const derived = deriveDebtCreditGrowth(snapshot)[0]!;
    expect(derived.observations.find((point) => point.period === "2026-Q2")?.value).toBeNull();
    expect(derived.observations.find((point) => point.period === "2026-Q3")?.value).toBeNull();
    expect(
      deriveDebtCreditGrowth({
        ...snapshot,
        series: [{ ...series, indicator: "privateDebt", unit: "percentGdp" }],
      }),
    ).toEqual([]);
  });
});
