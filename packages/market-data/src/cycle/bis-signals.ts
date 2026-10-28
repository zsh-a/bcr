import type { CycleObservation, CycleSeries, CycleSnapshot } from "./model";

const origin = "https://stats.bis.org/api/v2/data/dataflow/BIS";
export const BIS_SIGNAL_URLS = {
  policy: `${origin}/WS_CBPOL/1.0/M.CN+US+JP+GB+XM?c%5BTIME_PERIOD%5D=ge:2000-01`,
  houses: `${origin}/WS_SPP/1.0/Q.CN+US+JP+DE+GB.N+R.771?c%5BTIME_PERIOD%5D=ge:2000-Q1`,
} as const;
export const BIS_SIGNAL_ACCEPT = "application/vnd.sdmx.data+csv;version=1.0.0";
const licenseUrl = "https://data.bis.org/help/legal";
const countryIds: Readonly<Record<string, string>> = {
  CN: "CHN",
  US: "USA",
  JP: "JPN",
  DE: "DEU",
  GB: "GBR",
  XM: "DEU",
};
type CsvRow = Record<string, string>;

export function parseBisSignalsCsv(text: string, dimensions: string[] = []): CsvRow[] {
  const records: string[][] = [];
  let row: string[] = [],
    field = "",
    quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === '"') {
      if (quoted && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else quoted = !quoted;
    } else if (!quoted && (char === "," || char === "\n")) {
      row.push(field.replace(/\r$/u, ""));
      field = "";
      if (char === "\n") {
        if (row.some(Boolean)) records.push(row);
        row = [];
      }
    } else field += char;
  }
  if (quoted) throw new Error("BIS 周期 CSV 引号未闭合");
  if (field || row.length) {
    row.push(field.replace(/\r$/u, ""));
    records.push(row);
  }
  const header = records.shift()?.map((column) => column.replace(/^\uFEFF/u, ""));
  const required = [
    "DATAFLOW",
    "FREQ",
    "REF_AREA",
    "TIME_PERIOD",
    "OBS_VALUE",
    "UNIT_MEASURE",
    "UNIT_MULT",
    "OBS_STATUS",
    ...dimensions,
  ];
  if (
    !header ||
    new Set(header).size !== header.length ||
    required.some((column) => !header.includes(column))
  )
    throw new Error("BIS 周期 CSV 缺少数据维度");
  return records.map((values) => {
    if (values.length !== header.length) throw new Error("BIS 周期 CSV 列数不一致");
    return Object.fromEntries(header.map((column, index) => [column, values[index] ?? ""]));
  });
}
function validFetchedAt(value: string): void {
  const date = value.slice(0, 10),
    timestamp = Date.parse(`${date}T00:00:00Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}/u.test(value) ||
    !Number.isFinite(Date.parse(value)) ||
    !Number.isFinite(timestamp) ||
    new Date(timestamp).toISOString().slice(0, 10) !== date
  )
    throw new Error("BIS 周期资源抓取日期无效");
}
function observation(
  row: CsvRow,
  frequency: "M" | "Q",
  fetchedAt: string,
): CycleObservation | undefined {
  const period = row["TIME_PERIOD"] ?? "";
  const match = (frequency === "M" ? /^(\d{4})-(0[1-9]|1[0-2])$/u : /^(\d{4})-Q([1-4])$/u).exec(
    period,
  );
  if (!match) throw new Error("BIS 周期观测日期与频率不一致");
  const end = new Date(
    Date.UTC(Number(match[1]), Number(match[2]) * (frequency === "Q" ? 3 : 1), 0),
  )
    .toISOString()
    .slice(0, 10);
  const status = row["OBS_STATUS"] ?? "";
  if (
    period < (frequency === "M" ? "2000-01" : "2000-Q1") ||
    end > fetchedAt.slice(0, 10) ||
    status
      .split(",")
      .map((part) => part.trim())
      .includes("F") ||
    ["C", "D", "N", "S"].includes(row["OBS_CONF"] ?? "")
  )
    return undefined;
  const raw = row["OBS_VALUE"] ?? "",
    value = raw === "" || raw === "NA" || raw === "NaN" ? null : Number(raw);
  if (
    value !== null &&
    (!Number.isFinite(value) || !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/u.test(raw))
  )
    throw new Error("BIS 周期观测值无效");
  return status ? { period, value, status } : { period, value };
}
function add(series: CycleSeries, point: CycleObservation): void {
  const existing = series.observations.find((item) => item.period === point.period);
  if (existing && (existing.value !== point.value || existing.status !== point.status))
    throw new Error("BIS 周期同期观测冲突");
  if (!existing) series.observations.push(point);
}
const sorted = (series: Iterable<CycleSeries>) =>
  [...series].map((item) => ({
    ...item,
    observations: item.observations.sort((a, b) => a.period.localeCompare(b.period)),
  }));

const policyNotes: Readonly<Record<string, string>> = {
  CN: "中国：2019-08-20起采用1年期LPR，此前为1年期贷款基准利率；不是7天逆回购利率，不应将工具切换视作普通加降息。原始来源：中国人民银行。",
  XM: "德国采用欧元区XM的ECB政策参考利率，并非德国独立政策利率。2024-09-18从主要再融资操作利率MRO切至存款便利利率DFR；2000-06和2008-10也存在操作利率定义切换。应把工具变更与普通加降息区别。原始来源：European Central Bank。",
  JP: "日本为BIS选定的短期政策/代表利率，工具和操作框架多次切换；无可用政策利率的月份保留真实缺口，不补零、不延续上一值。原始来源：Bank of Japan。",
  US: "美国为美联储目标利率区间中点，不是有效联邦基金利率或区间上限。原始来源：US Federal Reserve System。",
  GB: "英国自2006-08-03采用官方Bank Rate，此前为repo rate等历史代表利率；保留BIS原始工具切换。原始来源：Bank of England。",
};
export function parseBisPolicyCsv(text: string, fetchedAt: string): CycleSeries[] {
  validFetchedAt(fetchedAt);
  const series = new Map<string, CycleSeries>();
  for (const row of parseBisSignalsCsv(text)) {
    const area = row["REF_AREA"] ?? "",
      country = countryIds[area];
    if (
      !country ||
      !policyNotes[area] ||
      row["DATAFLOW"] !== "BIS:WS_CBPOL(1.0)" ||
      row["FREQ"] !== "M" ||
      row["UNIT_MEASURE"] !== "368" ||
      row["UNIT_MULT"] !== "0"
    )
      throw new Error("BIS 政策利率地区、频率或年百分率单位不匹配");
    const point = observation(row, "M", fetchedAt);
    if (!point) continue;
    const item =
      series.get(country) ??
      ({
        country,
        indicator: "policyRate",
        frequency: "M",
        unit: "percent",
        seasonalAdjustment: "NSA",
        source: {
          name: `BIS / ${row["SOURCE_REF"] || (area === "XM" ? "European Central Bank" : area)}`,
          url: BIS_SIGNAL_URLS.policy,
          seriesCode: `BIS:WS_CBPOL(1.0)/M.${area}`,
          licenseUrl,
        },
        fetchedAt,
        sourceUpdatedAt: null,
        note: `${policyNotes[area]} 月度值为参考月最后一个营业日的年利率（%），不是日频值或月内平均。各国政策框架并非完全相同。CSV未提供原始发布/修订日期；历史方法见 https://www.bis.org/statistics/cbpol/cbpol_doc.pdf 。中文说明为非官方翻译，不代表BIS认可。`,
        observations: [],
      } satisfies CycleSeries);
    add(item, point);
    series.set(country, item);
  }
  return sorted(series.values());
}

const houseNotes: Readonly<Record<string, string>> = {
  CN: "中国仅为70城住宅价格代表序列，不是全国全部住宅；2016-Q1从新建住宅切换为存量住宅，存在范围变化。原始来源：中国国家统计局。",
  JP: "日本2008-Q2起为住宅价格，此前为城市住宅土地价格；土地到住宅的范围切换不能当作纯房价周期。原始来源：日本国土交通省、日本不动产研究所。",
  DE: "德国2014-Q1起采用联邦统计局房价指数；2006—2013为vdpResearch自有住宅，2000—2005为125城排屋及公寓，历史覆盖不是始终全国一致。原始来源：Deutsche Bundesbank、Statistisches Bundesamt等。",
  US: "美国基础指标为存量住宅价格，原始基础序列经季调，不代表新房与所有住房的统一价格。原始来源：Federal Reserve（基于CoreLogic）。",
  GB: "英国为ONS住宅价格代表序列，覆盖各类住宅，2005年前后有历史序列衔接。原始来源：Office for National Statistics。",
};
export function parseBisHousePricesCsv(text: string, fetchedAt: string): CycleSeries[] {
  validFetchedAt(fetchedAt);
  const series = new Map<string, CycleSeries>();
  for (const row of parseBisSignalsCsv(text, ["VALUE"])) {
    const area = row["REF_AREA"] ?? "",
      country = countryIds[area],
      kind = row["VALUE"];
    if (
      !country ||
      !houseNotes[area] ||
      row["DATAFLOW"] !== "BIS:WS_SPP(1.0)" ||
      row["FREQ"] !== "Q" ||
      !["N", "R"].includes(kind ?? "") ||
      row["UNIT_MEASURE"] !== "771" ||
      row["UNIT_MULT"] !== "0"
    )
      throw new Error("BIS 住宅价格地区、名义/实际或同比单位不匹配");
    const point = observation(row, "Q", fetchedAt);
    if (!point) continue;
    const indicator = kind === "N" ? "nominalHousePrices" : "realHousePrices",
      key = `${country}:${indicator}`;
    // US nominal input is explicitly SA; no separate seasonal flag is supplied for CPI-deflated real rates.
    const adjustment = area === "US" ? (kind === "N" ? "SA" : "notApplicable") : "NSA";
    const item =
      series.get(key) ??
      ({
        country,
        indicator,
        frequency: "Q",
        unit: "percent",
        seasonalAdjustment: adjustment,
        source: {
          name: "BIS Selected Residential Property Prices",
          url: BIS_SIGNAL_URLS.houses,
          seriesCode: `BIS:WS_SPP(1.0)/Q.${area}.${kind}.771`,
          licenseUrl,
        },
        fetchedAt,
        sourceUpdatedAt: null,
        note: `${houseNotes[area]} BIS直接发布的${kind === "N" ? "名义" : "CPI平减后实际"}住宅价格季度同比（UNIT_MEASURE=771），不是指数点位、环比或折年率；本项目未自行拼接或重算。${area === "US" ? (kind === "R" ? "实际序列由经季调名义基础价格以CPI平减，接口未披露平减后的独立季调标记，勿据此构造季调环比。" : "美国名义基础序列为SA。") : "保留来源未经季调口径。"} Selected系列旨在增强可比性，仍有国家范围和历史方法差异。CSV未提供原始发布日期。方法见 https://www.bis.org/statistics/pp_selected_documentation.pdf 。中文说明为非官方翻译，不代表BIS认可。`,
        observations: [],
      } satisfies CycleSeries);
    add(item, point);
    series.set(key, item);
  }
  return sorted(series.values());
}
async function requestCsv(url: string, signal?: AbortSignal) {
  const timeout = AbortSignal.timeout(60_000);
  const response = await fetch(url, {
    headers: { Accept: BIS_SIGNAL_ACCEPT },
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  });
  if (!response.ok)
    throw new Error(`BIS 周期数据请求失败（HTTP ${response.status}），请保留已有资源`);
  return response.text();
}
/** Explicit two-query ingestion; static-resource import never initiates external requests. */
export async function fetchBisSignalsSnapshot(signal?: AbortSignal): Promise<CycleSnapshot> {
  const policy = await requestCsv(BIS_SIGNAL_URLS.policy, signal),
    houses = await requestCsv(BIS_SIGNAL_URLS.houses, signal);
  const fetchedAt = new Date().toISOString(),
    series = [
      ...parseBisPolicyCsv(policy, fetchedAt),
      ...parseBisHousePricesCsv(houses, fetchedAt),
    ];
  const complete = ["CHN", "USA", "JPN", "DEU", "GBR"].every((country) =>
    ["policyRate", "nominalHousePrices", "realHousePrices"].every((indicator) =>
      series.some(
        (item) =>
          item.country === country &&
          item.indicator === indicator &&
          item.observations.some((point) => point.value !== null),
      ),
    ),
  );
  if (!complete) throw new Error("BIS 政策利率或住宅价格国家覆盖不完整");
  return { version: 1, fetchedAt, series };
}
