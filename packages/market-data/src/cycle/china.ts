import type { CycleObservation, CycleSeries, CycleSnapshot } from "./model";

/** Pinned original release: reproducible 13-month official table, not a silently rolling source. */
export const CHINA_PMI_SOURCE_URL =
  "https://www.stats.gov.cn/zwfwck/sjfb/202609/t20260930_1965449.html";
const licenseUrl = "https://www.stats.gov.cn/wzgl/202302/t20230217_1912857.html";
function plainText(value: string) {
  return value
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/giu, "")
    .replace(/<[^>]+>/gu, " ")
    .replace(/&nbsp;|&#160;|\u00a0/gu, " ")
    .replace(/&amp;/gu, "&")
    .replace(/\s+/gu, " ")
    .trim();
}
function tables(html: string): string[][][] {
  return [...html.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/giu)].map((table) =>
    [...(table[1] ?? "").matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/giu)].map((row) =>
      [...(row[1] ?? "").matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/giu)].map((cell) =>
        plainText(cell[1] ?? ""),
      ),
    ),
  );
}
function observations(rows: string[][], column: number, fetchedAt: string): CycleObservation[] {
  const values = new Map<string, CycleObservation>();
  for (const row of rows) {
    const periodMatch = /^(\d{4})年(\d{1,2})月$/u.exec((row[0] ?? "").replaceAll(" ", ""));
    if (!periodMatch) continue;
    const month = Number(periodMatch[2]);
    if (month < 1 || month > 12) throw new Error("国家统计局 PMI 观测月份无效");
    const period = `${periodMatch[1]}-${String(month).padStart(2, "0")}`;
    if (period > fetchedAt.slice(0, 7)) continue;
    const raw = row[column]?.trim();
    if (raw === undefined) throw new Error("国家统计局 PMI 表格列数不完整");
    const value = raw === "" || raw === "—" || raw === "-" ? null : Number(raw);
    if (value !== null && (!Number.isFinite(value) || value < 0 || value > 100))
      throw new Error("国家统计局 PMI 值超出扩散指数范围");
    const existing = values.get(period);
    if (existing && existing.value !== value) throw new Error("国家统计局 PMI 同期记录冲突");
    values.set(period, { period, value });
  }
  return [...values.values()].sort((a, b) => a.period.localeCompare(b.period));
}

export function parseChinaPmiHtml(html: string, fetchedAt: string): CycleSnapshot {
  if (!Number.isFinite(Date.parse(fetchedAt))) throw new Error("国家统计局抓取时间无效");
  const parsed = tables(html);
  const manufacturing = parsed.find(
    (table) =>
      table.some((row) => row.includes("PMI")) &&
      table.some((row) => row.join("").includes("新订单")),
  );
  const nonManufacturing = parsed.find((table) => table.some((row) => row.includes("商务活动")));
  if (!manufacturing || !nonManufacturing || !plainText(html).includes("经季节调整"))
    throw new Error("国家统计局 PMI 表格或季节调整说明缺失");
  const published = /发布时间[：:]\s*(\d{4}-\d{2}-\d{2})/u.exec(plainText(html))?.[1];
  if (!published || !Number.isFinite(Date.parse(published)) || published > fetchedAt.slice(0, 10))
    throw new Error("国家统计局发布日期缺失或晚于抓取时间");
  const specs = [
    {
      indicator: "pmiManufacturing" as const,
      table: manufacturing,
      column: 1,
      code: "NBS.MANUFACTURING_PMI",
      name: "国家统计局：中国制造业采购经理指数",
    },
    {
      indicator: "pmiNewOrders" as const,
      table: manufacturing,
      column: 3,
      code: "NBS.MANUFACTURING_NEW_ORDERS",
      name: "国家统计局：制造业新订单指数",
    },
    {
      indicator: "pmiNonManufacturing" as const,
      table: nonManufacturing,
      column: 1,
      code: "NBS.NONMANUFACTURING_BUSINESS_ACTIVITY",
      name: "国家统计局：非制造业商务活动（含建筑业）",
    },
  ];
  const series: CycleSeries[] = specs.map((spec) => ({
    country: "CHN",
    indicator: spec.indicator,
    frequency: "M",
    unit: "index",
    seasonalAdjustment: "SA",
    source: { name: spec.name, url: CHINA_PMI_SOURCE_URL, seriesCode: spec.code, licenseUrl },
    fetchedAt,
    sourceUpdatedAt: published,
    note: "国家统计局 2026 年 9 月原始发布表，保留 2025-09 至 2026-09 共 13 个月，指数 50 为扩张/收缩分界；来源页面以 % 表示。非制造业包含建筑业，不是纯服务业 PMI。来源日期为整表发布日，不是每个历史值的首次公布日；后续续期需更新固定来源 URL。",
    observations: observations(spec.table, spec.column, fetchedAt),
  }));
  if (series.some((item) => item.observations.length < 12))
    throw new Error("国家统计局 PMI 历史表不足 12 个月，请保留原快照");
  return { version: 1, fetchedAt, series };
}

export async function fetchChinaCycleSnapshot(signal?: AbortSignal): Promise<CycleSnapshot> {
  const timeout = AbortSignal.timeout(45_000);
  const response = await fetch(CHINA_PMI_SOURCE_URL, {
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  });
  if (!response.ok) throw new Error(`国家统计局 PMI 请求失败（HTTP ${response.status}）`);
  return parseChinaPmiHtml(await response.text(), new Date().toISOString());
}
