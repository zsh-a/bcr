import type { CycleObservation, CycleSeries, CycleSnapshot } from "./model";
import { OECD_CYCLE_COUNTRIES, parseOecdCsv } from "./oecd";

const countries = new Set<string>(OECD_CYCLE_COUNTRIES);
const key = [OECD_CYCLE_COUNTRIES.join("+"), "M", "BCICP+CCICP", "", "", "", "", "", ""].join(".");
export const OECD_CONFIDENCE_URL = `https://sdmx.oecd.org/public/rest/data/OECD.SDD.STES,DSD_STES@DF_CLI,4.1/${key}?startPeriod=2000-01&format=csvfile`;
const licenseUrl = "https://www.oecd.org/en/about/terms-conditions.html";
const descriptions = {
  BCICP: {
    indicator: "businessConfidence",
    definition:
      "OECD 标准化企业信心 BCI，仅覆盖制造业生产、订单及产成品库存问卷，不代表服务业或整个企业部门。",
    url: "https://www.oecd.org/en/data/indicators/business-confidence-index-bci.html",
  },
  CCICP: {
    indicator: "consumerConfidence",
    definition:
      "OECD 标准化消费者信心 CCI，反映家庭财务、整体经济、失业与储蓄预期，不是实际消费量。",
    url: "https://www.oecd.org/en/data/indicators/consumer-confidence-index-cci.html",
  },
} as const;

function parsePoint(row: Record<string, string>, fetchedAt: string): CycleObservation | undefined {
  const period = row["TIME_PERIOD"] ?? "";
  if (!/^\d{4}-(0[1-9]|1[0-2])$/u.test(period)) throw new Error("OECD 信心观测期与月频不一致");
  if (row["UNIT_MULT"] !== "0") throw new Error("OECD 信心指数单位倍数不匹配");
  const status = row["OBS_STATUS"] ?? "";
  if (
    period < "2000-01" ||
    period > fetchedAt.slice(0, 7) ||
    status.split(",").some((value) => value.trim() === "F")
  )
    return undefined;
  const raw = row["OBS_VALUE"] ?? "";
  const value = raw === "" || raw === "NA" || raw === "NaN" ? null : Number(raw);
  if (value !== null && (!Number.isFinite(value) || raw.trim() === ""))
    throw new Error("OECD 信心指数观测值无效");
  return status ? { period, value, status } : { period, value };
}

/** Only the harmonised, amplitude-adjusted index. National survey balances are incompatible. */
export function parseOecdConfidenceCsv(text: string, fetchedAt: string): CycleSeries[] {
  if (!Number.isFinite(Date.parse(fetchedAt))) throw new Error("OECD 信心抓取时间无效");
  const groups = new Map<string, CycleSeries>();
  const points = new Map<string, CycleObservation>();
  for (const row of parseOecdCsv(text, ["ACTIVITY", "TIME_HORIZ", "METHODOLOGY"])) {
    const country = row["REF_AREA"] ?? "";
    const measure = row["MEASURE"];
    if (
      !countries.has(country) ||
      row["DATAFLOW"] !== "OECD.SDD.STES:DSD_STES@DF_CLI(4.1)" ||
      row["FREQ"] !== "M" ||
      (measure !== "BCICP" && measure !== "CCICP") ||
      row["UNIT_MEASURE"] !== "IX" ||
      row["ACTIVITY"] !== "_Z" ||
      row["ADJUSTMENT"] !== "AA" ||
      row["TRANSFORMATION"] !== "IX" ||
      row["TIME_HORIZ"] !== "_Z" ||
      row["METHODOLOGY"] !== "H"
    )
      throw new Error("OECD 信心数据维度、频率或标准化口径不匹配");
    const point = parsePoint(row, fetchedAt);
    if (!point) continue;
    const definition = descriptions[measure];
    const seriesKey = `${country}/${definition.indicator}`;
    const pointKey = `${seriesKey}/${point.period}`;
    const previous = points.get(pointKey);
    if (previous) {
      if (previous.value !== point.value || previous.status !== point.status)
        throw new Error("OECD 信心同期观测冲突");
      continue;
    }
    const series =
      groups.get(seriesKey) ??
      ({
        country,
        indicator: definition.indicator,
        frequency: "M",
        unit: "index",
        seasonalAdjustment: "notApplicable",
        source: {
          name: "OECD Data Explorer · Harmonised confidence indices",
          url: OECD_CONFIDENCE_URL,
          seriesCode: `OECD.SDD.STES:DSD_STES@DF_CLI(4.1)/${country}.M.${measure}.IX._Z.AA.IX._Z.H`,
          licenseUrl,
        },
        fetchedAt,
        sourceUpdatedAt: null,
        note: `${definition.definition}官方 AA 为振幅调整，100 为长期平均；此接口维度没有单列季调标记，勿将 AA 直接当作 SA。指数高低反映相对长期平均的信心，不是经济增长率、PMI 50 扩张线或衰退判断。国别原始问卷与覆盖存在差异；使用 OECD harmonised 口径，不混入本国原始净差额或基期指数。会随新数据修订；当前快照不是历史实时版本。CSV 未提供原始发布日期，来源更新时间留空。定义：${definition.url} 中文说明为非官方译释；来源 OECD。`,
        observations: [],
      } satisfies CycleSeries);
    series.observations.push(point);
    groups.set(seriesKey, series);
    points.set(pointKey, point);
  }
  return [...groups.values()]
    .map((series) => ({
      ...series,
      observations: series.observations.sort((left, right) =>
        left.period.localeCompare(right.period),
      ),
    }))
    .sort((left, right) =>
      `${left.country}/${left.indicator}`.localeCompare(`${right.country}/${right.indicator}`),
    );
}

/** One batched official request; importing this module never downloads data. OECD allows 60/hour. */
export async function fetchConfidenceSnapshot(signal?: AbortSignal): Promise<CycleSnapshot> {
  const timeout = AbortSignal.timeout(60_000);
  const response = await fetch(OECD_CONFIDENCE_URL, {
    headers: { Accept: "text/csv" },
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  });
  if (!response.ok)
    throw new Error(`OECD 信心数据请求失败（HTTP ${response.status}），请保留已有快照后重试`);
  const text = await response.text();
  const fetchedAt = new Date().toISOString();
  const series = parseOecdConfidenceCsv(text, fetchedAt);
  if (series.length !== countries.size * 2 || series.some((item) => item.observations.length < 12))
    throw new Error("OECD 信心国家或指标覆盖不完整，请保留已有快照");
  return { version: 1, fetchedAt, series };
}
