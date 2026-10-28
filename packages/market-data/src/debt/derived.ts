import { debtQuarterIndex, debtQuarterPeriod } from "./analysis";
import type { DebtSeries, DebtSnapshot } from "./model";

/** Derived from break-adjusted local-currency levels, not an official published growth series. */
export function deriveDebtCreditGrowth(snapshot: DebtSnapshot): DebtSeries[] {
  return snapshot.series
    .filter((series) => series.indicator === "privateCreditStock" && series.frequency === "Q")
    .map<DebtSeries>((series) => {
      const lookup = new Map(series.observations.map((point) => [point.period, point.value]));
      return {
        ...series,
        indicator: "creditGrowth",
        unit: "percent",
        currency: null,
        valuation: "notApplicable",
        source: {
          ...series.source,
          name: `${series.source.name} · 本币余额同比计算`,
          seriesCode: `${series.source.seriesCode} / derived-yoy-4q`,
        },
        note: `计算值：(本季本币余额 / 四季前本币余额 − 1) × 100。保留 BIS 的断点调整，不额外调整汇率、估值或统计重分类影响；不是官方发布同比，也不是信用脉冲。底层来源：${series.note}`,
        observations: series.observations.map((point) => {
          const previous = lookup.get(debtQuarterPeriod(debtQuarterIndex(point.period) - 4));
          return {
            period: point.period,
            value:
              point.value === null || previous === undefined || previous === null || previous <= 0
                ? null
                : (point.value / previous - 1) * 100,
            status: point.status ? `derived:${point.status}` : "derived",
          };
        }),
      };
    });
}
