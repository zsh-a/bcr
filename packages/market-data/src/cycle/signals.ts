import { cycleExact, getCycleSeries, shiftMonth } from "./analysis";
import type {
  CycleIndicatorId,
  CycleObservation,
  CycleSeries,
  CycleSnapshot,
  CycleUnit,
} from "./model";

function derived(
  source: CycleSeries,
  indicator: CycleIndicatorId,
  unit: CycleUnit,
  formula: string,
  observations: CycleObservation[],
  inputs: CycleSeries[] = [source],
): CycleSeries {
  return {
    ...source,
    indicator,
    unit,
    source: {
      ...source.source,
      name: `${source.source.name} · 计算值`,
      seriesCode: `${source.source.seriesCode} / derived-${indicator}`,
    },
    fetchedAt: inputs
      .map((item) => item.fetchedAt)
      .sort()
      .at(-1)!,
    sourceUpdatedAt: null,
    note: `计算值：${formula}。输入与来源：${inputs.map((item) => `${item.indicator} (${item.source.seriesCode}, ${item.source.url}, 抓取 ${item.fetchedAt}, 来源日期 ${item.sourceUpdatedAt ?? "未提供"})`).join("；")}。使用当前修订历史值，不代表当时的信息集。${source.note ?? ""}`,
    observations: observations.map((point) => ({
      ...point,
      status: `derived${point.status ? `:${point.status}` : ""}`,
    })),
  };
}
/** Exact-period calculations only. Missing input periods remain missing. */
export function deriveCycleSignals(snapshot: CycleSnapshot): CycleSeries[] {
  const result: CycleSeries[] = [];
  for (const rate of snapshot.series.filter(
    (series) =>
      series.indicator === "policyRate" && series.frequency === "M" && series.unit === "percent",
  )) {
    const prices = getCycleSeries(snapshot, rate.country, "inflation");
    if (!prices || prices.frequency !== "M" || prices.unit !== "percent") continue;
    result.push(
      derived(
        rate,
        "realPolicyRate",
        "percent",
        "月末政策参考利率 − 同月 CPI 同比。这是事后实际利率近似，不是预期实际利率或统一政策松紧阈值；欧元区共同利率与德国国别 CPI 的组合仅为国别近似",
        rate.observations.map((point) => {
          const inflation = cycleExact(prices, point.period);
          return {
            ...point,
            value: point.value === null || inflation === null ? null : point.value - inflation,
          };
        }),
        [rate, prices],
      ),
    );
  }
  const payroll = getCycleSeries(snapshot, "USA", "payrolls");
  if (
    payroll?.frequency === "M" &&
    payroll.unit === "thousandPersons" &&
    payroll.seasonalAdjustment === "SA"
  )
    result.push(
      derived(
        payroll,
        "payrollChange",
        "thousandPersons",
        "季调非农人数本月减上月，千人；未跨越缺月取最近值",
        payroll.observations.map((point) => {
          const previous = cycleExact(payroll, shiftMonth(point.period, -1));
          return {
            ...point,
            value: point.value === null || previous === null ? null : point.value - previous,
          };
        }),
      ),
    );
  const core = getCycleSeries(snapshot, "USA", "corePriceIndex");
  if (core?.frequency === "M" && core.unit === "index" && core.seasonalAdjustment === "SA")
    result.push(
      derived(
        core,
        "coreInflation3m",
        "percent",
        "((本月季调核心 CPI 指数 / 三个月前指数)^4 − 1) × 100；须有四个连续有效且为正的月度指数，不从同比反推",
        core.observations.map((point) => {
          const history = Array.from({ length: 4 }, (_, index) =>
            cycleExact(core, shiftMonth(point.period, index - 3)),
          );
          return {
            ...point,
            value: history.some((value) => value === null || value <= 0)
              ? null
              : ((history[3]! / history[0]!) ** 4 - 1) * 100,
          };
        }),
      ),
    );
  const unemployment = getCycleSeries(snapshot, "USA", "unemployment");
  if (
    unemployment?.frequency === "M" &&
    unemployment.unit === "percent" &&
    unemployment.seasonalAdjustment === "SA"
  )
    result.push(
      derived(
        unemployment,
        "unemploymentGap",
        "percentagePoints",
        "当前失业率三月均值 − 最近12个月（含当月）三月均值最低值；需要14个连续有效月份。仅作为美国描述指标，不是实时萨姆序列、不自动判定衰退",
        unemployment.observations.map((point) => {
          const months = Array.from({ length: 14 }, (_, index) =>
            cycleExact(unemployment, shiftMonth(point.period, index - 13)),
          );
          if (months.some((value) => value === null)) return { ...point, value: null };
          const means = Array.from(
            { length: 12 },
            (_, index) => (months[index]! + months[index + 1]! + months[index + 2]!) / 3,
          );
          return { ...point, value: means.at(-1)! - Math.min(...means) };
        }),
      ),
    );
  return result;
}
