import type { CycleIndicatorId, CycleObservation, CycleSeries, CycleSnapshot } from "./model";

const base = "https://www.stats.gov.cn/sj/xwfbh/fbhwd/";
/** Fixed original official releases. Extend deliberately; imports perform no requests. */
export const CHINA_ACTIVITY_RELEASES = [
  ["2025-06", "202507/t20250715_1960414.html"],
  ["2025-07", "202508/t20250815_1960789.html"],
  ["2025-08", "202509/t20250915_1961181.html"],
  ["2025-09", "202510/t20251020_1961612.html"],
  ["2025-10", "202511/t20251114_1961858.html"],
  ["2025-11", "202512/t20251215_1962075.html"],
  ["2025-12", "202601/t20260119_1962330.html"],
  ["2026-02", "202603/t20260316_1962780.html"],
  ["2026-03", "202604/t20260416_1963330.html"],
  ["2026-04", "202605/t20260518_1963732.html"],
  ["2026-05", "202606/t20260616_1963954.html"],
  ["2026-06", "202607/t20260715_1964121.html"],
  ["2026-07", "202608/t20260817_1965056.html"],
  ["2026-08", "202609/t20260915_1965307.html"],
  ["2026-09", "202610/t20261019_1965618.html"],
].map(([period, path]) => ({ period: period!, url: `${base}${path}` }));
const licenseUrl = "https://www.stats.gov.cn/wzgl/202302/t20230217_1912857.html";
const specs = [
  {
    indicator: "industrialProduction",
    label: /^(?:[一二三四五六七八九十]+、)?规模以上工业增加值$/u,
    column: 2,
    code: "INDUSTRIAL_VALUE_ADDED_MONTHLY_YOY",
    definition:
      "规模以上工业增加值当月实际同比，按可比价计算；不是月环比、累计同比或整个工业的产出规模。1—2月合并数据不拆成单月，1、2月留缺口。",
  },
  {
    indicator: "retailNominal",
    label: /^(?:[一二三四五六七八九十]+、)?社会消费品零售总额[（(]亿元[）)]$/u,
    column: 2,
    code: "RETAIL_SALES_MONTHLY_NOMINAL_YOY",
    definition:
      "社会消费品零售总额当月名义同比，未扣除价格因素；包含商品零售与餐饮，不是全部服务消费或实际零售量。1—2月合并数据不拆成单月，1、2月留缺口。",
  },
  {
    indicator: "unemployment",
    label: /^(?:[一二三四五六七八九十]+、)?全国城镇调查失业率[（(]%[）)]$/u,
    column: 1,
    code: "NATIONAL_URBAN_SURVEY_UNEMPLOYMENT_RATE",
    definition:
      "全国城镇调查失业率当月水平，非季调；不是31个大城市、登记失业率、青年失业率或年内平均失业率。不同国家劳动力调查范围不可视为完全可比。",
  },
  {
    indicator: "housingSalesYtd",
    label: /^(?:新建)?商品房销售面积[（(]万平方米[）)]$/u,
    column: 4,
    code: "NEW_COMMERCIAL_FLOORSPACE_SALES_YTD_YOY",
    definition:
      "新建商品房销售面积年初至本月累计同比（YTD），面积口径、包含住宅及非住宅；不是单月销量、二手房或房价。",
  },
  {
    indicator: "housingStartsYtd",
    label: /^房屋新开工面积[（(]万平方米[）)]$/u,
    column: 4,
    code: "PROPERTY_FLOORSPACE_STARTS_YTD_YOY",
    definition:
      "房地产开发企业房屋新开工面积年初至本月累计同比（YTD），包含住宅及非住宅；不是单月住宅开工套数，不与美国季调折年套数混用。",
  },
  {
    indicator: "realEstateInvestmentYtd",
    label: /^房地产开发投资[（(]亿元[）)]$/u,
    column: 4,
    code: "PROPERTY_DEVELOPMENT_INVESTMENT_YTD_NOMINAL_YOY",
    definition:
      "房地产开发投资年初至本月累计名义同比（YTD），未扣除价格因素；不是单月投资或实际投资增长。",
  },
] satisfies {
  indicator: CycleIndicatorId;
  label: RegExp;
  column: number;
  code: string;
  definition: string;
}[];

function plain(value: string): string {
  return value
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/giu, "")
    .replace(/<[^>]+>/gu, " ")
    .replace(/&#(\d+);/gu, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([\da-f]+);/giu, (_, code: string) =>
      String.fromCodePoint(Number.parseInt(code, 16)),
    )
    .replace(/&nbsp;|&ensp;|&emsp;|\u00a0/gu, " ")
    .replace(/&amp;/gu, "&")
    .replace(/\s+/gu, "")
    .trim();
}
function tables(html: string): string[][][] {
  return [...html.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/giu)].map((table) =>
    [...(table[1] ?? "").matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/giu)].map((row) =>
      [...(row[1] ?? "").matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/giu)].map((cell) =>
        plain(cell[1] ?? ""),
      ),
    ),
  );
}
function dateValid(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(date)) return false;
  const parsed = new Date(`${date}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
}
function number(raw: string | undefined): number | null {
  if (raw === undefined) throw new Error("国家统计局活动表格列数不足");
  if (["", "…", "...", "—", "-"].includes(raw)) return null;
  const normalized = raw.replace(/[−－]/gu, "-");
  if (!/^[+-]?\d+(?:\.\d+)?$/u.test(normalized)) throw new Error("国家统计局活动数据不是有效数值");
  const value = Number(normalized);
  if (!Number.isFinite(value)) throw new Error("国家统计局活动数值无效");
  return value;
}
export interface ChinaActivityPage {
  period: string;
  url: string;
  html: string;
}
interface Release {
  period: string;
  url: string;
  published: string;
  values: Map<CycleIndicatorId, number | null>;
}

/** Parse only the comprehensive monthly/YTD table, never the nearby seasonally adjusted MoM table. */
export function parseChinaActivityRelease(page: ChinaActivityPage, fetchedAt: string): Release {
  if (!Number.isFinite(Date.parse(fetchedAt)) || !dateValid(fetchedAt.slice(0, 10)))
    throw new Error("国家统计局活动抓取时间无效");
  if (!/^\d{4}-(0[1-9]|1[0-2])$/u.test(page.period) || page.period > fetchedAt.slice(0, 7))
    throw new Error("国家统计局活动月份无效或晚于抓取时间");
  if (
    !/^https:\/\/www\.stats\.gov\.cn\/sj\/(?:xwfbh\/fbhwd|zxfb)\/\d{6}\/t\d{8}_\d+\.html$/u.test(
      page.url,
    )
  )
    throw new Error("国家统计局活动来源地址无效");
  const published = /<meta\s+name=["']PubDate["']\s+content=["'](\d{4})\/(\d{2})\/(\d{2})/iu.exec(
    page.html,
  );
  const date = published ? `${published[1]}-${published[2]}-${published[3]}` : "";
  if (!dateValid(date) || date > fetchedAt.slice(0, 10) || date.slice(0, 7) < page.period)
    throw new Error("国家统计局活动发布日期缺失或无效");
  const expectedPublicationMonth =
    Number(page.period.slice(0, 4)) * 12 + Number(page.period.slice(5, 7));
  const publicationMonth = Number(date.slice(0, 4)) * 12 + Number(date.slice(5, 7)) - 1;
  if (publicationMonth !== expectedPublicationMonth)
    throw new Error("国家统计局活动发布年份与观测月份不匹配");
  const text = plain(page.html);
  const year = page.period.slice(0, 4),
    month = Number(page.period.slice(5, 7));
  if (!text.includes(`${year}年`) || !text.includes("按可比价计算"))
    throw new Error("国家统计局活动年份或工业实际口径说明缺失");
  const candidates = tables(page.html).filter(
    (table) =>
      table.some((row) => row.some((cell) => specs[0]!.label.test(cell))) &&
      table.some(
        (row) =>
          row[0] === "指标" &&
          row[1] === `${month}月` &&
          row[2]?.replaceAll("-", "—") === `1—${month}月`,
      ) &&
      table.some(
        (row) => row[0] === "绝对量" && row[1] === "同比增长（%）" && row[3] === "同比增长（%）",
      ),
  );
  if (!candidates.length) throw new Error("国家统计局活动主表或月份表头缺失");
  const values = new Map<CycleIndicatorId, number | null>();
  for (const table of candidates) {
    for (const spec of specs) {
      if (
        month <= 2 &&
        (spec.indicator === "industrialProduction" || spec.indicator === "retailNominal")
      )
        continue;
      const matches = table.filter((row) => spec.label.test(row[0] ?? ""));
      if (matches.length !== 1) throw new Error(`国家统计局活动指标缺失或重复：${spec.indicator}`);
      const value = number(matches[0]?.[spec.column]);
      if (spec.indicator === "unemployment" && value !== null && (value < 0 || value > 100))
        throw new Error("国家统计局调查失业率超出百分比范围");
      if (values.has(spec.indicator) && values.get(spec.indicator) !== value)
        throw new Error("国家统计局活动重复主表数据冲突");
      values.set(spec.indicator, value);
    }
  }
  return { period: page.period, url: page.url, published: date, values };
}

export function parseChinaActivityPages(
  pages: ChinaActivityPage[],
  fetchedAt: string,
): CycleSnapshot {
  const releases = pages.map((page) => parseChinaActivityRelease(page, fetchedAt));
  const periods = new Map<string, Release>();
  for (const release of releases) {
    const previous = periods.get(release.period);
    if (previous && JSON.stringify([...previous.values]) !== JSON.stringify([...release.values]))
      throw new Error("国家统计局活动同期发布数据冲突");
    if (!previous || previous.published < release.published) periods.set(release.period, release);
  }
  const unique = [...periods.values()].sort((left, right) =>
    left.period.localeCompare(right.period),
  );
  const series: CycleSeries[] = specs.map((spec) => {
    const available = unique.filter((release) => release.values.has(spec.indicator));
    const observations: CycleObservation[] = available.map((release) => ({
      period: release.period,
      value: release.values.get(spec.indicator) ?? null,
    }));
    const latest = available.at(-1);
    return {
      country: "CHN",
      indicator: spec.indicator,
      frequency: "M",
      unit: "percent",
      seasonalAdjustment: "NSA",
      source: {
        name: "国家统计局 · 国民经济运行综合发布附表",
        url: latest?.url ?? base,
        seriesCode: `NBS.RELEASE.${spec.code}`,
        licenseUrl,
      },
      fetchedAt,
      sourceUpdatedAt: latest?.published ?? null,
      note: `${spec.definition}仅收录固定综合发布页集合的2025-06至2026-09有限历史。各期按对应发布附表提取，保留原有可比口径，不从绝对量重算、不填补缺失月份；不是统一最新修订版或可用于实时回测的历史版本。来源更新日期为本序列末期对应整页发布日，不是所有历史值的首次发布日期。逐期原始发布：${available.map((release) => `${release.period}（${release.published}）：${release.url}`).join("；")}。`,
      observations,
    };
  });
  return { version: 1, fetchedAt, series };
}

/** Fifteen pinned official pages, at most three concurrent. Failure leaves the previous resource intact. */
export async function fetchChinaActivitySnapshot(signal?: AbortSignal): Promise<CycleSnapshot> {
  const pages: ChinaActivityPage[] = [];
  for (let index = 0; index < CHINA_ACTIVITY_RELEASES.length; index += 3) {
    pages.push(
      ...(await Promise.all(
        CHINA_ACTIVITY_RELEASES.slice(index, index + 3).map(async (release) => {
          const timeout = AbortSignal.timeout(25_000);
          const response = await fetch(release.url, {
            signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
          });
          if (!response.ok)
            throw new Error(`国家统计局活动请求失败（HTTP ${response.status}）：${release.period}`);
          return { ...release, html: await response.text() };
        }),
      )),
    );
  }
  const result = parseChinaActivityPages(pages, new Date().toISOString());
  if (
    result.series.some(
      (item) => item.observations.filter((point) => point.value !== null).length < 12,
    )
  )
    throw new Error("国家统计局活动有效历史不足12期，请保留已有快照");
  return result;
}
