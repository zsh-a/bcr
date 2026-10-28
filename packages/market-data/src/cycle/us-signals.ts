import type {
  CycleIndicatorId,
  CycleObservation,
  CycleSeries,
  CycleSnapshot,
  CycleUnit,
} from "./model";

export interface UsSignalDefinition {
  code: string;
  indicator: CycleIndicatorId;
  frequency: "M" | "Q";
  unit: CycleUnit;
  seasonalAdjustment: "SA" | "NSA";
  publisher: string;
  licenseUrl: string;
  note: string;
}

const BLS_LICENSE = "https://www.bls.gov/bls/linksite.htm";
const FED_LICENSE = "https://www.federalreserve.gov/disclaimer.htm";
const BEA_LICENSE = "https://www.bea.gov/help/faq/147";
// Original Census/HUD federal statistical works; not a licence granted by FRED hosting.
const CENSUS_LICENSE = "https://www.copyright.gov/title17/92chap1.html#105";

/** Original federal statistical releases, attributed individually; no commercial datasets. */
export const US_SIGNAL_DEFINITIONS: readonly UsSignalDefinition[] = [
  {
    code: "JTSJOR",
    indicator: "jobOpenings",
    frequency: "M",
    unit: "percent",
    seasonalAdjustment: "SA",
    publisher: "U.S. Bureau of Labor Statistics",
    licenseUrl: BLS_LICENSE,
    note: "JOLTS 全部非农职位空缺率，百分比；分母为就业人数加职位空缺数，不是职位空缺人数。原始历史从 2000-12 开始，未补齐更早月份。",
  },
  {
    code: "JTSQUR",
    indicator: "quitsRate",
    frequency: "M",
    unit: "percent",
    seasonalAdjustment: "SA",
    publisher: "U.S. Bureau of Labor Statistics",
    licenseUrl: BLS_LICENSE,
    note: "JOLTS 全部非农主动离职率，主动离职人数占就业人数的百分比，不含解雇；原始历史从 2000-12 开始。",
  },
  {
    code: "AWHAETP",
    indicator: "weeklyHours",
    frequency: "M",
    unit: "hours",
    seasonalAdjustment: "SA",
    publisher: "U.S. Bureau of Labor Statistics",
    licenseUrl: BLS_LICENSE,
    note: "私人非农部门全体雇员平均每周获薪工时，小时，月度观测；不是生产与非管理人员口径，也不是周频数据。原始历史从 2006-03 开始。",
  },
  {
    code: "HOUST",
    indicator: "housingStarts",
    frequency: "M",
    unit: "thousandUnits",
    seasonalAdjustment: "SA",
    publisher: "U.S. Census Bureau / HUD",
    licenseUrl: CENSUS_LICENSE,
    note: "私人拥有的新建住宅开工总套数，千套、季调年化水平（SAAR）；不是当月实际套数，也不是增长率。保留原始年化值，未除以 12。",
  },
  {
    code: "PERMIT",
    indicator: "buildingPermits",
    frequency: "M",
    unit: "thousandUnits",
    seasonalAdjustment: "SA",
    publisher: "U.S. Census Bureau / HUD",
    licenseUrl: CENSUS_LICENSE,
    note: "发放许可地区私人新建住宅获批总套数，千套、季调年化水平（SAAR）；不是当月实际套数，不等同开工，保留原值未除以 12。",
  },
  {
    code: "DRTSCILM",
    indicator: "loanStandards",
    frequency: "Q",
    unit: "percent",
    seasonalAdjustment: "NSA",
    publisher: "Board of Governors of the Federal Reserve System",
    licenseUrl: FED_LICENSE,
    note: "SLOOS 国内银行对大中型企业工商业贷款的信贷标准调查净比例：收紧标准银行占比减放松标准银行占比；正值表示净收紧，负值表示净放松。未季调，不是贷款增速。季度标签沿用 FRED 调查期，非当季贷款流量。",
  },
  {
    code: "DRSDCILM",
    indicator: "loanDemand",
    frequency: "Q",
    unit: "percent",
    seasonalAdjustment: "NSA",
    publisher: "Board of Governors of the Federal Reserve System",
    licenseUrl: FED_LICENSE,
    note: "SLOOS 国内银行报告大中型企业工商业贷款需求的调查净比例：需求增强银行占比减需求减弱银行占比；正值表示净增强，负值表示净减弱。未季调，不是贷款金额或增速；季度标签沿用 FRED 调查期。",
  },
  {
    code: "CPILFESL",
    indicator: "corePriceIndex",
    frequency: "M",
    unit: "index",
    seasonalAdjustment: "SA",
    publisher: "U.S. Bureau of Labor Statistics",
    licenseUrl: BLS_LICENSE,
    note: "城市消费者 CPI 剔除食品和能源的季调价格指数，1982–84=100；保留原始指数，未转换为同比或三个月折年率。季调历史会修订。",
  },
  {
    code: "CPIAUCSL",
    indicator: "priceIndex",
    frequency: "M",
    unit: "index",
    seasonalAdjustment: "SA",
    publisher: "U.S. Bureau of Labor Statistics",
    licenseUrl: BLS_LICENSE,
    note: "城市消费者全项目 CPI 季调价格指数，1982–84=100；保留原始指数，不是通胀同比百分比。季调历史会修订。",
  },
  {
    code: "TCU",
    indicator: "capacityUtilization",
    frequency: "M",
    unit: "percent",
    seasonalAdjustment: "SA",
    publisher: "Board of Governors of the Federal Reserve System",
    licenseUrl: FED_LICENSE,
    note: "G.17 总体工业产能利用率，百分比，覆盖制造业、采矿和电力燃气公用事业；不是工业生产增速或全经济产能利用率。",
  },
  {
    code: "ISRATIO",
    indicator: "inventorySalesRatio",
    frequency: "M",
    unit: "ratio",
    seasonalAdjustment: "SA",
    publisher: "U.S. Census Bureau",
    licenseUrl: CENSUS_LICENSE,
    note: "制造与贸易企业期末库存相对于当月销售的库存销售比，季调比率，不是百分比或实际库存增长率。来源曾按 NAICS 重新编制历史，沿用当前公布版本。",
  },
  {
    code: "PB0000031Q225SBEA",
    indicator: "privateDemandGrowth",
    frequency: "Q",
    unit: "percent",
    seasonalAdjustment: "SA",
    publisher: "U.S. Bureau of Economic Analysis",
    licenseUrl: BEA_LICENSE,
    note: "实际私人国内最终销售（个人消费与私人固定投资）的较前季变化季调折年率（SAAR），不含库存、净出口与政府需求；不是同比，也不是普通环比。BEA 账户 PB000003。",
  },
];

export const US_SIGNALS_START = "2000-01-01";
export const US_SIGNAL_PROVENANCE_NOTE =
  "原始机构联邦统计经 FRED 获取，按原机构署名；权利依据见原机构政策或联邦作品规定。保留抓取时公开 CSV 的修订历史，非实时历史版本。CSV 不提供发布日期，来源更新日期记未知，抓取时间不代表发布日。";

function validDay(value: string): boolean {
  return (
    /^\d{4}-\d{2}-\d{2}$/u.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value
  );
}

/** Validate both native FRED first-day dates and stored monthly/quarterly labels. */
export function normalizeUsSignalPeriod(
  value: string,
  frequency: "M" | "Q",
  now = new Date(),
): string {
  if (!Number.isFinite(now.getTime())) throw new Error("美国信号抓取日期无效");
  let day = value;
  if (frequency === "M" && /^\d{4}-(?:0[1-9]|1[0-2])$/u.test(value)) day = `${value}-01`;
  if (frequency === "Q" && /^\d{4}-Q[1-4]$/u.test(value))
    day = `${value.slice(0, 4)}-${String((Number(value.at(-1)) - 1) * 3 + 1).padStart(2, "0")}-01`;
  if (!validDay(day) || !day.endsWith("-01") || day > now.toISOString().slice(0, 10))
    throw new Error(`美国信号日期无效或位于未来：${value}`);
  if (frequency === "M") return day.slice(0, 7);
  const month = Number(day.slice(5, 7));
  if (![1, 4, 7, 10].includes(month)) throw new Error(`美国信号日期不是季度首日：${value}`);
  return `${day.slice(0, 4)}-Q${Math.ceil(month / 3)}`;
}

function cell(value: string): string {
  const text = value.trim();
  if (!text.includes('"')) return text;
  if (!/^"[^"]*"$/u.test(text)) throw new Error("美国信号 CSV 引号无效");
  return text.slice(1, -1);
}

/** No implicit transformations, interpolation or forward fill; zero and null stay distinct. */
export function parseUsSignalsCsv(
  csv: string,
  definition: UsSignalDefinition,
  now = new Date(),
): CycleObservation[] {
  if (csv.length > 2_000_000) throw new Error("美国信号 CSV 超出大小限制");
  const lines = csv
    .replace(/^\uFEFF/u, "")
    .trim()
    .split(/\r?\n/u);
  const header = lines.shift()?.split(",").map(cell);
  if (
    !header ||
    header.length !== 2 ||
    !["observation_date", "DATE"].includes(header[0] ?? "") ||
    header[1] !== definition.code
  )
    throw new Error(`FRED ${definition.code} CSV 表头无效`);
  if (!lines.length || lines.length > 10_000) throw new Error("美国信号 CSV 观测数量无效");
  const seen = new Set<string>(),
    observations: CycleObservation[] = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    const cells = line.split(",").map(cell);
    if (cells.length !== 2 || !/^\d{4}-\d{2}-\d{2}$/u.test(cells[0]!))
      throw new Error(`FRED ${definition.code} CSV 原生日期或列数无效`);
    const period = normalizeUsSignalPeriod(cells[0]!, definition.frequency, now);
    if (seen.has(period)) throw new Error(`FRED ${definition.code} 包含重复期次`);
    seen.add(period);
    const raw = cells[1]!;
    if (
      raw !== "" &&
      raw !== "." &&
      (!/^[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[-+]?\d+)?$/iu.test(raw) || !Number.isFinite(Number(raw)))
    )
      throw new Error(`FRED ${definition.code} 包含无效数值`);
    if (cells[0]! >= US_SIGNALS_START)
      observations.push({ period, value: raw === "" || raw === "." ? null : Number(raw) });
  }
  if (!observations.some((point) => point.value !== null))
    throw new Error(`FRED ${definition.code} 缺少可用历史观测`);
  return observations.sort((a, b) => a.period.localeCompare(b.period));
}

async function fetchUsSignal(
  definition: UsSignalDefinition,
  signal?: AbortSignal,
): Promise<CycleSeries> {
  const timeout = AbortSignal.timeout(25_000);
  const response = await fetch(
    `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${definition.code}&cosd=${US_SIGNALS_START}`,
    {
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    },
  );
  if (!response.ok) throw new Error(`FRED ${definition.code} HTTP ${response.status}`);
  const observations = parseUsSignalsCsv(await response.text(), definition);
  return {
    country: "USA",
    indicator: definition.indicator,
    frequency: definition.frequency,
    unit: definition.unit,
    seasonalAdjustment: definition.seasonalAdjustment,
    source: {
      name: `${definition.publisher} · FRED`,
      url: `https://fred.stlouisfed.org/series/${definition.code}`,
      seriesCode: definition.code,
      licenseUrl: definition.licenseUrl,
    },
    fetchedAt: new Date().toISOString(),
    sourceUpdatedAt: null,
    note: `${definition.note} ${US_SIGNAL_PROVENANCE_NOTE}`,
    observations,
  };
}

/** Atomic refresh: a failed source rejects the refresh instead of silently dropping a signal. */
export async function fetchUsSignalsSnapshot(signal?: AbortSignal): Promise<CycleSnapshot> {
  if (signal?.aborted) throw signal.reason;
  const results = await Promise.allSettled(
    US_SIGNAL_DEFINITIONS.map((definition) => fetchUsSignal(definition, signal)),
  );
  if (signal?.aborted) throw signal.reason;
  const series: CycleSeries[] = [];
  for (const result of results) {
    if (result.status === "rejected") throw result.reason;
    series.push(result.value);
  }
  return { version: 1, fetchedAt: new Date().toISOString(), series };
}
