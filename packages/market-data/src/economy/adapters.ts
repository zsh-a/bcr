import { cycleDisplayObservations, cycleDisplayUnit } from "../cycle/analysis";
import type { CycleSnapshot } from "../cycle/model";
import type { DebtSnapshot } from "../debt/model";
import {
  MACRO_INDICATORS,
  MACRO_LICENSE_URL,
  MACRO_SOURCE,
  MACRO_SOURCE_URL,
} from "../macro/catalog";
import type { MacroSnapshot } from "../macro/model";
import type { EconomicDomain, EconomicPoint, EconomicSeries } from "./model";
import { economicPeriodEnd } from "./period";

const annualDefinitions = new Map(MACRO_INDICATORS.map((item) => [item.id, item]));
function identify(domain: EconomicDomain, series: Omit<EconomicSeries, "id">): EconomicSeries {
  const id = [
    domain,
    series.country,
    series.metricId,
    series.source.seriesCode,
    series.frequency,
    series.seasonalAdjustment,
    series.rawUnit,
    series.currency ?? "",
    series.valuation ?? "",
  ]
    .map(encodeURIComponent)
    .join("/");
  const periods = new Set<string>();
  for (const point of series.observations) {
    if (
      periods.has(point.period) ||
      [point.value, point.rawValue].some((value) => value !== null && !Number.isFinite(value))
    )
      throw new Error("经济序列存在重复期次或无效数值");
    periods.add(point.period);
  }
  return {
    ...series,
    id,
    source: { ...series.source },
    observations: [...series.observations].sort((a, b) => a.date.localeCompare(b.date)),
  };
}
function markedComputed(code: string, observations: { status?: string }[]): boolean {
  return (
    /derived/iu.test(code) ||
    observations.some((point) => /^derived(?::|$)/u.test(point.status ?? ""))
  );
}
export function adaptAnnualSnapshot(snapshot: MacroSnapshot): EconomicSeries[] {
  return snapshot.series.map((series) => {
    const definition = annualDefinitions.get(series.indicator);
    if (!definition) throw new Error("年度经济指标未定义");
    return identify("annual", {
      metricId: `annual:${series.indicator}`,
      country: series.country,
      frequency: "A",
      unit: definition.unit,
      rawUnit: definition.unit,
      currency: definition.unit === "usd" ? "USD" : null,
      seasonalAdjustment: "notApplicable",
      valuation: definition.unit === "usd" ? "nominal" : null,
      source: {
        name: MACRO_SOURCE,
        url: MACRO_SOURCE_URL,
        seriesCode: definition.code,
        licenseUrl: MACRO_LICENSE_URL,
      },
      fetchedAt: series.fetchedAt ?? snapshot.fetchedAt,
      sourceUpdatedAt: series.sourceUpdatedAt || snapshot.sourceUpdatedAt || null,
      note: `年度指标（A），保留年度原值，不与同名月度或季度指标拼接。${definition.description}来源更新时间为世界银行 WDI 数据页更新日期，不是各历史年度的首次发布日期；每条序列保留其抓取与来源更新日期。`,
      computed: false,
      observations: series.observations.map((point) => ({
        period: String(point.year),
        date: economicPeriodEnd(String(point.year), "A"),
        value: point.value,
        rawValue: point.value,
      })),
    });
  });
}
export function adaptCycleSnapshot(snapshot: CycleSnapshot): EconomicSeries[] {
  return snapshot.series.map((series) => {
    const displayed = cycleDisplayObservations(series),
      unit = cycleDisplayUnit(series);
    const raw = new Map(series.observations.map((point) => [point.period, point]));
    const converted = unit !== series.unit;
    const observations: EconomicPoint[] = displayed.map((point) => ({
      period: point.period,
      date: economicPeriodEnd(point.period, series.frequency),
      value: point.value,
      rawValue: raw.get(point.period)?.value ?? null,
      ...(point.status === undefined ? {} : { status: point.status }),
    }));
    return identify("cycle", {
      metricId: `cycle:${series.indicator}`,
      country: series.country,
      frequency: series.frequency,
      unit,
      rawUnit: series.unit,
      currency: series.unit === "billionsUsd" && !converted ? "USD" : null,
      seasonalAdjustment: series.seasonalAdjustment,
      valuation: null,
      source: series.source,
      fetchedAt: series.fetchedAt,
      sourceUpdatedAt: series.sourceUpdatedAt,
      note: `${converted ? "展示计算值：严格同月同比（本月原始值 / 十二个月前原始值 − 1）× 100；缺失或零基期时为空。原始值及原始单位另存，不以百分点冒充增长率。" : ""}${series.note ?? ""}`,
      computed: converted || markedComputed(series.source.seriesCode, series.observations),
      observations,
    });
  });
}
export function adaptDebtSnapshot(snapshot: DebtSnapshot): EconomicSeries[] {
  return snapshot.series.map((series) =>
    identify("debt", {
      metricId: `debt:${series.indicator}`,
      country: series.country,
      frequency: series.frequency,
      unit: series.unit,
      rawUnit: series.unit,
      currency: series.currency,
      seasonalAdjustment: series.seasonalAdjustment,
      valuation: series.valuation,
      source: series.source,
      fetchedAt: series.fetchedAt,
      sourceUpdatedAt: series.sourceUpdatedAt,
      note: series.note,
      computed: markedComputed(series.source.seriesCode, series.observations),
      observations: series.observations.map((point) => ({
        ...point,
        date: economicPeriodEnd(point.period, series.frequency),
        rawValue: point.value,
      })),
    }),
  );
}
