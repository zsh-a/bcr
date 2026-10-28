import type { DebtIndicatorId, DebtObservation, DebtSeries, DebtSnapshot } from "./model";

export const CHINA_CREDIT_INDEX = "https://www.pbc.gov.cn/diaochatongjisi/116219/116319/index.html";
export const CHINA_CREDIT_START = 2024;
export const CHINA_CREDIT_IDS = [
  "socialFinancingGrowth",
  "socialFinancingFlow",
  "governmentBondFlow",
  "corporateBondFlow",
  "rmbLoanFlow",
] as const;
type ChinaIndicator = (typeof CHINA_CREDIT_IDS)[number];
type ChinaTableData = Record<ChinaIndicator, DebtObservation[]>;

const clean = (value: string) =>
  value
    .replace(/<!--[\s\S]*?-->/gu, "")
    .replace(/<[^>]*>/gu, "")
    .replace(/&nbsp;|&#160;|&#x0*a0;/giu, " ")
    .replace(/&amp;/gu, "&")
    .replace(/\s+/gu, " ")
    .trim();
const compact = (value: string) => clean(value).replace(/\s+/gu, "");
const rows = (html: string) =>
  [...html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/giu)].map((row) =>
    [...row[1]!.matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/giu)].map((cell) => clean(cell[1]!)),
  );
const emptyData = (): ChinaTableData => ({
  socialFinancingGrowth: [],
  socialFinancingFlow: [],
  governmentBondFlow: [],
  corporateBondFlow: [],
  rmbLoanFlow: [],
});

function valueOf(value: string | undefined): number | null {
  if (value === undefined) throw new Error("社融表列数不足");
  const text = value.trim();
  if (!text || text === "—" || text === "-" || text === "…") return null;
  if (!/^-?(?:\d+(?:\.\d*)?|\.\d+)$/u.test(text) || !Number.isFinite(Number(text)))
    throw new Error(`社融表数值无效：${text}`);
  return Number(text);
}

function periodOf(value: string, year: number): string {
  const match = /^(\d{4})\.(\d{1,2})$/u.exec(value);
  if (!match || Number(match[1]) !== year || Number(match[2]) < 1 || Number(match[2]) > 12)
    throw new Error("社融表月份或年度无效");
  return `${match[1]}-${match[2]!.padStart(2, "0")}`;
}

function addPoint(target: DebtObservation[], period: string, value: number | null, now: Date) {
  if (period > now.toISOString().slice(0, 7)) {
    if (value !== null) throw new Error("社融表包含未来月份数值");
    return;
  }
  if (target.some((point) => point.period === period)) throw new Error("社融表包含重复月份");
  target.push({ period, value });
}

/** PBOC Excel-exported HTML is GB2312/GBK, not reliably UTF-8. */
export function decodeChinaSource(bytes: Uint8Array): string {
  const header = new TextDecoder().decode(bytes.slice(0, 1500));
  const charset = /charset\s*=\s*["']?\s*([a-z\d_-]+)/iu.exec(header)?.[1];
  return new TextDecoder(charset && /gb2312|gbk|gb18030/iu.test(charset) ? "gb18030" : "utf-8", {
    fatal: true,
  }).decode(bytes);
}

/** Read the published monthly flows directly. No cumulative differences are calculated. */
export function parseChinaFlowTable(html: string, year: number, now = new Date()): ChinaTableData {
  const table = rows(html),
    text = compact(html);
  if (
    !text.includes("AFRE(flow)") ||
    !(/单位[:：]亿元人民币/u.test(text) || /Unit:100millionYuan/iu.test(text))
  )
    throw new Error("社融增量表标题或亿元单位不匹配");
  const heading = table.find((row) => row.some((cell) => compact(cell) === "AFRE(flow)"));
  if (!heading) throw new Error("社融增量表缺少英文列定义");
  const columns = [
    ["socialFinancingFlow", "AFRE(flow)"],
    ["rmbLoanFlow", "RMBloans"],
    ["corporateBondFlow", "Netfinancingofcorporatebonds"],
    ["governmentBondFlow", "Governmentbonds"],
  ] as const;
  const positions = columns.map(([id, label]) => ({
    id,
    index: heading.findIndex((cell) => compact(cell).toLowerCase() === label.toLowerCase()),
  }));
  if (
    positions.some((column) => column.index < 0) ||
    new Set(positions.map((column) => column.index)).size !== 4
  )
    throw new Error("社融增量表列定义改变");
  const data = emptyData();
  for (const row of table.filter((item) => /^\d{4}\.\d{1,2}$/u.test(item[0] ?? ""))) {
    const period = periodOf(row[0]!, year);
    const values = positions.map((column) => ({
      ...column,
      value: valueOf(row[column.index + 1]),
    }));
    if (values.every((column) => column.value === null)) continue; // Unreleased calendar placeholders.
    for (const column of values)
      addPoint(data[column.id], period, column.value === null ? null : column.value / 10_000, now);
  }
  if (!data.socialFinancingFlow.some((point) => point.value !== null))
    throw new Error("社融增量表没有可用月度值");
  return data;
}

/** Use the published AFRE stock growth row, not a rate inferred from incompatible vintages. */
export function parseChinaStockGrowth(
  html: string,
  year: number,
  now = new Date(),
): DebtObservation[] {
  const table = rows(html),
    text = compact(html);
  if (
    !text.includes("AFRE(stock)") ||
    !text.includes("GrowthRate(%)") ||
    !(/单位[:：]万亿元人民币/u.test(text) || /Unit:TrillionYuan/iu.test(text))
  )
    throw new Error("社融存量表标题、增速列或单位不匹配");
  const header = table.find(
    (row) => row.filter((cell) => /^\d{4}\.\d{1,2}$/u.test(cell)).length === 12,
  );
  const months = header
    ?.filter((cell) => /^\d{4}\.\d{1,2}$/u.test(cell))
    .map((cell) => periodOf(cell, year));
  const row = table.find((item) => compact(item[0] ?? "").endsWith("AFRE(stock)"));
  if (!months || new Set(months).size !== 12 || !row || row.length < 25)
    throw new Error("社融存量表月份或总量行结构改变");
  const data: DebtObservation[] = [];
  for (let index = 0; index < months.length; index += 1) {
    const stock = valueOf(row[1 + index * 2]),
      growth = valueOf(row[2 + index * 2]);
    if (stock === null && growth === null) continue;
    if (stock !== null && stock < 0) throw new Error("社融存量不能为负");
    addPoint(data, months[index]!, growth, now);
  }
  if (!data.some((point) => point.value !== null)) throw new Error("社融存量表没有可用同比值");
  return data;
}

function links(html: string, base: string): { label: string; url: string }[] {
  return [...html.matchAll(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/giu)].flatMap(
    (match) => {
      let url: URL;
      try {
        url = new URL(match[1]!, base);
      } catch {
        return []; // Ignore unrelated placeholder anchors such as href="http://".
      }
      return url.protocol === "https:" && url.hostname === "www.pbc.gov.cn"
        ? [{ label: compact(match[2]!), url: url.href }]
        : [];
    },
  );
}

export function discoverChinaYearPages(
  html: string,
  now = new Date(),
): { year: number; url: string }[] {
  let currentYear = 0;
  const years = new Map<number, string>();
  for (const link of links(html, CHINA_CREDIT_INDEX)) {
    const match = /^(\d{4})年统计数据$/u.exec(link.label);
    if (match) currentYear = Number(match[1]);
    if (
      link.label === "社会融资规模" &&
      currentYear >= CHINA_CREDIT_START &&
      currentYear <= now.getUTCFullYear() &&
      !years.has(currentYear)
    )
      years.set(currentYear, link.url);
  }
  if (!years.size) throw new Error("PBOC 统计目录未发现可用社融年份");
  return [...years].sort(([a], [b]) => a - b).map(([year, url]) => ({ year, url }));
}

export function discoverChinaTables(html: string, page: string): { flow: string; stock: string } {
  const htmlLinks = links(html, page).filter((link) => link.label.toLowerCase() === "htm");
  if (
    htmlLinks.length !== 2 ||
    htmlLinks.some((link) => !/\.html?$/iu.test(new URL(link.url).pathname))
  )
    throw new Error("PBOC 社融原始表链接结构改变");
  return { flow: htmlLinks[0]!.url, stock: htmlLinks[1]!.url };
}

async function htmlSource(url: string, signal?: AbortSignal): Promise<string> {
  const timeout = AbortSignal.timeout(20_000);
  const response = await fetch(url, {
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  });
  if (!response.ok) throw new Error(`PBOC 统计源 HTTP ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length > 3_000_000) throw new Error("PBOC 统计源响应过大");
  return decodeChinaSource(bytes);
}

export async function fetchChinaDebtSnapshot(signal?: AbortSignal): Promise<DebtSnapshot> {
  const now = new Date(),
    pages = discoverChinaYearPages(await htmlSource(CHINA_CREDIT_INDEX, signal), now);
  const observations = emptyData(),
    sources: { year: number; flow: string; stock: string }[] = [];
  for (const page of pages) {
    if (signal?.aborted) throw signal.reason;
    const tables = discoverChinaTables(await htmlSource(page.url, signal), page.url);
    const [flowHtml, stockHtml] = await Promise.all([
      htmlSource(tables.flow, signal),
      htmlSource(tables.stock, signal),
    ]);
    const flow = parseChinaFlowTable(flowHtml, page.year, now),
      growth = parseChinaStockGrowth(stockHtml, page.year, now);
    for (const id of CHINA_CREDIT_IDS)
      observations[id].push(...(id === "socialFinancingGrowth" ? growth : flow[id]));
    sources.push({ year: page.year, ...tables });
  }
  const fetchedAt = new Date().toISOString(),
    latest = sources.at(-1)!;
  const series: DebtSeries[] = CHINA_CREDIT_IDS.map((id) => {
    const growth = id === "socialFinancingGrowth";
    const specifics: Record<ChinaIndicator, string> = {
      socialFinancingGrowth: "社会融资规模存量的官方月末同比增速，直接读取原表增速列。",
      socialFinancingFlow: "社会融资规模当月增量，包含非金融企业境内股权融资，不能视为纯债务。",
      governmentBondFlow: "社融口径政府债券当月融资增量，不是债券发行总额。",
      corporateBondFlow: "社融口径企业债券当月净融资，可为负，不是企业债发行总额。",
      rmbLoanFlow: "社融口径对实体经济人民币贷款当月增量，不是金融机构全部人民币贷款增量。",
    };
    return {
      country: "CHN",
      indicator: id,
      frequency: "M",
      unit: growth ? "percent" : "trillionLocal",
      currency: growth ? null : "CNY",
      seasonalAdjustment: "NSA",
      valuation: "nominal",
      source: {
        name: "中国人民银行 · 社会融资规模统计",
        url: growth ? latest.stock : latest.flow,
        seriesCode: `PBOC_AFRE:${id}`,
        licenseUrl: "https://www.pbc.gov.cn/rmyh/109345/index.html",
      },
      fetchedAt,
      sourceUpdatedAt: null,
      note: `${specifics[id]}${growth ? "增速单位为%。" : "逐月原值，非年内累计；原表亿元÷10000转换为万亿元。"} 未季调，存在春节等季节因素；按年度原表拼接，历史口径调整和修订以原表为准。上传路径日期不冒充发布日期。年度原表：${sources.map((source) => `${source.year} ${growth ? source.stock : source.flow}`).join("；")}`,
      observations: observations[id].sort((a, b) => a.period.localeCompare(b.period)),
    };
  });
  return { version: 1, fetchedAt, series };
}

export function isChinaCreditIndicator(value: unknown): value is DebtIndicatorId {
  return CHINA_CREDIT_IDS.some((id) => id === value);
}
