import type {
  CycleFrequency,
  CycleIndicatorId,
  CycleObservation,
  CycleSeries,
  CycleSnapshot,
  CycleUnit,
} from "./model";

export interface FredCycleDefinition {
  code: string;
  indicator: CycleIndicatorId;
  frequency: CycleFrequency;
  unit: CycleUnit;
  seasonalAdjustment: CycleSeries["seasonalAdjustment"];
  publisher: string;
  note: string;
  mirror?: { path: string; scale?: number; subtractPath?: string };
  yearOverYear?: boolean;
}

/** Chicago Fed CFNAI/NFCI are deliberately excluded pending redistribution permission.
 * These definitions cover public statistical series; metadata keeps original credits.
 */
// prettier-ignore
export const FRED_CYCLE_DEFINITIONS: readonly FredCycleDefinition[] = [
  {"code":"INDPRO","indicator":"industrialProduction","frequency":"M","unit":"index","seasonalAdjustment":"SA","publisher":"Federal Reserve Board","note":"工业生产总指数，季节调整；指数基期以原始来源说明为准。","mirror":{"path":"FED/G17_IP_MAJOR_INDUSTRY_GROUPS/IP.B50001.S"}},
  {"code":"PCEC96","indicator":"realConsumption","frequency":"M","unit":"billionsUsd","seasonalAdjustment":"SA","publisher":"BEA","note":"实际个人消费支出 PCE，并非零售销售；十亿美元、链式 2017 年美元、季调年率。","mirror":{"path":"BEA/NIPA-T20806/DPCERX-M","scale":0.001}},
  {"code":"PAYEMS","indicator":"payrolls","frequency":"M","unit":"thousandPersons","seasonalAdjustment":"SA","publisher":"BLS","note":"非农就业人数水平，千人；并非当月新增就业。","mirror":{"path":"BLS/ce/CES0000000001"}},
  {"code":"UNRATE","indicator":"unemployment","frequency":"M","unit":"percent","seasonalAdjustment":"SA","publisher":"BLS","note":"16 岁及以上人口失业率，季节调整。","mirror":{"path":"BLS/ln/LNS14000000"}},
  {"code":"ICSA","indicator":"initialClaims","frequency":"W","unit":"persons","seasonalAdjustment":"SA","publisher":"U.S. Employment and Training Administration","note":"首次申请失业保险人数，季节调整，周六结束周；并非持续领取人数。"},
  {"code":"T10Y3M","indicator":"yieldSpread","frequency":"D","unit":"percentagePoints","seasonalAdjustment":"NSA","publisher":"Federal Reserve Bank of St. Louis","note":"10 年期减 3 个月期美国国债恒定期限收益率之差，百分点，原生日频；节假日缺失保持为空。","mirror":{"path":"FED/H15/RIFLGFCY10_N.B","subtractPath":"FED/H15/RIFLGFCM03_N.B"}},
  {"code":"W875RX1","indicator":"realIncome","frequency":"M","unit":"billionsUsd","seasonalAdjustment":"SA","publisher":"BEA","note":"扣除经常转移收入的实际个人收入；十亿美元、链式 2017 年美元、季调年率。","mirror":{"path":"BEA/NIPA-T20600/W875RX-M","scale":0.001}},
  {"code":"CPIAUCNS","indicator":"inflation","frequency":"M","unit":"percent","seasonalAdjustment":"NSA","publisher":"BLS","note":"全项目 CPI 未季调指数计算的同比变化率，严格使用同月上年值；不是 CPI 指数点位。","mirror":{"path":"BLS/cu/CUUR0000SA0"},"yearOverYear":true},
  {"code":"CPILFESL","indicator":"coreInflation","frequency":"M","unit":"percent","seasonalAdjustment":"SA","publisher":"BLS","note":"剔除食品和能源的季调 CPI 指数计算同比，严格使用同月上年值；与未季调同比口径有别。","mirror":{"path":"BLS/cu/CUSR0000SA0L1E"},"yearOverYear":true},
  {"code":"A191RL1Q225SBEA","indicator":"gdpQuarterlyAnnualized","frequency":"Q","unit":"percent","seasonalAdjustment":"SA","publisher":"BEA","note":"实际 GDP 较前季变化的季调折年率（SAAR），不是普通环比，也不是同比；跨国比较前须统一口径。","mirror":{"path":"BEA/NIPA-T10101/A191RL-Q"}},
];

function validDate(date: string): boolean {
  return (
    /^\d{4}-\d{2}-\d{2}$/u.test(date) &&
    Number.isFinite(Date.parse(date)) &&
    new Date(date).toISOString().slice(0, 10) === date
  );
}

function normalizedPeriod(date: string, frequency: CycleFrequency, today: string): string {
  const expanded = frequency === "M" && /^\d{4}-\d{2}$/u.test(date) ? `${date}-01` : date;
  if (frequency === "Q" && /^\d{4}-Q[1-4]$/u.test(date)) {
    const first = `${date.slice(0, 4)}-${String((Number(date.at(-1)) - 1) * 3 + 1).padStart(2, "0")}-01`;
    if (first > today) throw new Error(`周期数据含未来季度 ${date}`);
    return date;
  }
  if (!validDate(expanded) || expanded > today)
    throw new Error(`周期数据日期无效或位于未来：${date}`);
  if (frequency === "M") {
    if (!expanded.endsWith("-01")) throw new Error(`月度日期不是月初：${date}`);
    return expanded.slice(0, 7);
  }
  if (frequency === "Q") {
    const month = Number(expanded.slice(5, 7));
    if (!expanded.endsWith("-01") || ![1, 4, 7, 10].includes(month))
      throw new Error(`季度日期无效：${date}`);
    return `${expanded.slice(0, 4)}-Q${Math.ceil(month / 3)}`;
  }
  return expanded;
}

function numeric(value: unknown): number | null {
  if (value === null || value === "" || value === "." || value === "NA") return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (
    typeof value === "string" &&
    /^[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[-+]?\d+)?$/iu.test(value) &&
    Number.isFinite(Number(value))
  )
    return Number(value);
  throw new Error("周期数据包含无效数值");
}

function rowsToObservations(
  rows: [string, unknown][],
  frequency: CycleFrequency,
  now: Date,
): CycleObservation[] {
  if (rows.length === 0 || rows.length > 30_000) throw new Error("周期数据为空或超出观测数量限制");
  const values = new Map<string, number | null>();
  for (const [date, raw] of rows) {
    const period = normalizedPeriod(date, frequency, now.toISOString().slice(0, 10));
    if (values.has(period)) throw new Error(`周期数据包含重复期次：${period}`);
    values.set(period, numeric(raw));
  }
  return [...values]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([period, value]) => ({ period, value }));
}

/** Parse the official two-column graph CSV, keeping '.' and empty cells missing. */
export function parseFredCsv(
  csv: string,
  code: string,
  frequency: CycleFrequency,
  now = new Date(),
): CycleObservation[] {
  const lines = csv
    .replace(/^\uFEFF/u, "")
    .trim()
    .split(/\r?\n/u);
  const unquote = (cell: string) => cell.trim().replace(/^"(.*)"$/u, "$1");
  const header = lines.shift()?.split(",").map(unquote);
  if (
    !header ||
    header.length !== 2 ||
    !["observation_date", "DATE"].includes(header[0] ?? "") ||
    header[1] !== code
  )
    throw new Error(`FRED ${code} CSV 表头无效`);
  return rowsToObservations(
    lines
      .filter((line) => line.trim())
      .map((line) => {
        const cells = line.split(",").map(unquote);
        if (cells.length !== 2) throw new Error(`FRED ${code} CSV 列数无效`);
        return [cells[0]!, cells[1]!];
      }),
    frequency,
    now,
  );
}

export function monthlyYearOverYear(observations: readonly CycleObservation[]): CycleObservation[] {
  const values = new Map(observations.map((item) => [item.period, item.value]));
  return observations.map(({ period, value }) => {
    if (!/^\d{4}-\d{2}$/u.test(period)) throw new Error("同比计算只接受月度期次");
    const previous = values.get(`${Number(period.slice(0, 4)) - 1}${period.slice(4)}`);
    return {
      period,
      value:
        value === null || previous == null || previous <= 0 ? null : (value / previous - 1) * 100,
    };
  });
}

/** Align by the exact native date, never the nearest business day. */
export function subtractCycleObservations(
  left: readonly CycleObservation[],
  right: readonly CycleObservation[],
): CycleObservation[] {
  const a = new Map(left.map((point) => [point.period, point.value]));
  const b = new Map(right.map((point) => [point.period, point.value]));
  return [...new Set([...a.keys(), ...b.keys()])].sort().map((period) => {
    const x = a.get(period),
      y = b.get(period);
    return { period, value: x == null || y == null ? null : x - y };
  });
}

/** The official DOL download form exposes separate initial/continued and SA/NSA fields. */
export function parseInitialClaimsXml(xml: string, now = new Date()): CycleObservation[] {
  if (!xml.includes("<r539cyNational")) throw new Error("DOL 周度申请 XML 文档类型无效");
  const rows: [string, unknown][] = [];
  for (const match of xml.matchAll(/<week>([\s\S]*?)<\/week>/gu)) {
    const date = match[1]?.match(/<weekEnded>(\d{2})\/(\d{2})\/(\d{4})<\/weekEnded>/u);
    const initial = match[1]?.match(/<InitialClaims>([\s\S]*?)<\/InitialClaims>/u)?.[1];
    const value = initial
      ?.match(/<SA>([^<]*)<\/SA>/u)?.[1]
      ?.replace(/&#160;|&nbsp;/gu, "")
      .trim();
    if (!date || value === undefined || (value && !/^(?:\d+|\d{1,3}(?:,\d{3})+)$/u.test(value)))
      throw new Error("DOL 周度日期或初次申请季调值无效");
    const iso = `${date[3]}-${date[1]}-${date[2]}`;
    // The report includes future calendar weeks with only seasonal factors filled in.
    if (iso > now.toISOString().slice(0, 10) && !value) continue;
    if (new Date(iso).getUTCDay() !== 6) throw new Error("DOL 申请日期不是周六结束周");
    rows.push([iso, value.replaceAll(",", "")]);
  }
  return rowsToObservations(rows, "W", now);
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("周期数据对象无效");
  return value as Record<string, unknown>;
}

/** DBnomics is a transport mirror; its indexed_at is not an economic release date. */
export function parseFredMirror(
  payload: unknown,
  definition: FredCycleDefinition,
  now = new Date(),
): { observations: CycleObservation[]; sourceUpdatedAt: string | null } {
  const input = object(payload),
    group = object(input["series"]),
    docs = group["docs"];
  if (!definition.mirror || !Array.isArray(docs) || docs.length !== 1)
    throw new Error("周期镜像返回了错误的序列数量");
  const doc = object(docs[0]),
    [provider, dataset, code] = definition.mirror.path.split("/");
  if (
    doc["provider_code"] !== provider ||
    doc["dataset_code"] !== dataset ||
    doc["series_code"] !== code
  )
    throw new Error("周期镜像序列身份不匹配");
  const periods = doc["period"],
    values = doc["value"];
  if (
    !Array.isArray(periods) ||
    !Array.isArray(values) ||
    periods.length !== values.length ||
    periods.some((period) => typeof period !== "string")
  )
    throw new Error("周期镜像期次与数值不匹配");
  const observations = rowsToObservations(
    periods.map((period: string, index: number) => [period, values[index]]),
    definition.frequency,
    now,
  ).map((point) => ({
    ...point,
    value: point.value === null ? null : point.value * (definition.mirror?.scale ?? 1),
  }));
  const metadata = input["dataset"] ? object(input["dataset"]) : {};
  const revised =
    typeof metadata["name"] === "string"
      ? metadata["name"].match(/LastRevised: ([A-Za-z]+ \d{1,2}, \d{4})/u)?.[1]
      : undefined;
  const updated =
    revised && Number.isFinite(Date.parse(`${revised} UTC`))
      ? new Date(`${revised} UTC`).toISOString().slice(0, 10)
      : null;
  if (updated && updated > now.toISOString().slice(0, 10))
    throw new Error("周期来源修订日期位于未来");
  return { observations, sourceUpdatedAt: updated };
}

export function fredCycleStart(definition: FredCycleDefinition, now = new Date()): string {
  if (definition.frequency === "D")
    return new Date(Date.UTC(now.getUTCFullYear() - 5, now.getUTCMonth(), now.getUTCDate()))
      .toISOString()
      .slice(0, 10);
  if (definition.frequency === "W") return `${Math.max(2000, now.getUTCFullYear() - 10)}-01-01`;
  return "2000-01-01";
}

export function buildFredCycleSeries(
  definition: FredCycleDefinition,
  observations: CycleObservation[],
  fetchedAt: string,
  sourceUpdatedAt: string | null,
  mirror = false,
): CycleSeries {
  const now = new Date(fetchedAt);
  const start = fredCycleStart(definition, now).slice(0, definition.frequency === "M" ? 7 : 10);
  const transformed = definition.yearOverYear ? monthlyYearOverYear(observations) : observations;
  return {
    country: "USA",
    indicator: definition.indicator,
    frequency: definition.frequency,
    unit: definition.unit,
    seasonalAdjustment: definition.seasonalAdjustment,
    source: {
      name: `${definition.publisher} · ${mirror ? "DBnomics 镜像" : "FRED"}`,
      url: `https://fred.stlouisfed.org/series/${definition.code}`,
      seriesCode: mirror
        ? `${definition.code} / ${definition.mirror?.path ?? ""}`
        : definition.code,
      licenseUrl:
        definition.publisher === "BLS"
          ? "https://www.bls.gov/bls/linksite.htm"
          : "https://fred.stlouisfed.org/legal/terms/",
    },
    fetchedAt,
    sourceUpdatedAt,
    note: `${definition.note}${mirror ? " 原始机构数据经 DBnomics 镜像；镜像可能滞后，以最后有效期次为准，抓取日期不代表发布日。" : " 原始 CSV 未提供发布时间，来源更新日期记为未知。"}`,
    observations: transformed.filter((point) => point.period >= start),
  };
}

async function responseText(
  url: string,
  signal: AbortSignal | undefined,
  init: RequestInit = {},
): Promise<string> {
  const timeout = AbortSignal.timeout(15_000);
  const response = await fetch(url, {
    ...init,
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  });
  if (!response.ok) throw new Error(`周期来源 HTTP ${response.status}`);
  const text = await response.text();
  if (text.length > 3_000_000) throw new Error("周期来源响应超出大小限制");
  return text;
}

async function fetchSeries(
  definition: FredCycleDefinition,
  signal?: AbortSignal,
): Promise<CycleSeries> {
  if (signal?.aborted) throw signal.reason;
  const now = new Date();
  const start = definition.yearOverYear ? "1999-01-01" : fredCycleStart(definition, now);
  const url = `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${definition.code}&cosd=${start}`;
  try {
    const observations = parseFredCsv(
      await responseText(url, signal),
      definition.code,
      definition.frequency,
      now,
    );
    return buildFredCycleSeries(definition, observations, new Date().toISOString(), null);
  } catch (error) {
    if (signal?.aborted) throw signal.reason;
    console.warn(`[cycle] ${definition.code} FRED unavailable`, error);
  }
  if (definition.code === "ICSA") {
    try {
      const xml = await responseText(
        "https://oui.doleta.gov/unemploy/wkclaims/report.asp",
        signal,
        {
          method: "POST",
          body: new URLSearchParams({
            level: "us",
            strtdate: fredCycleStart(definition, now).slice(0, 4),
            enddate: String(now.getUTCFullYear()),
            filetype: "xml",
            submit: "Submit",
          }),
        },
      );
      const series = buildFredCycleSeries(
        definition,
        parseInitialClaimsXml(xml, now),
        new Date().toISOString(),
        null,
      );
      return {
        ...series,
        source: {
          name: "U.S. Department of Labor · ETA",
          url: "https://oui.doleta.gov/unemploy/claims.asp",
          seriesCode: "ETA 539 · InitialClaims/SA (ICSA equivalent)",
          licenseUrl: "https://www.dol.gov/general/aboutdol/copyright",
        },
        note: `${definition.note} 直接来自劳工部 ETA 周度报表；rundate 是报表生成日期，不是数据发布日期。`,
      };
    } catch (error) {
      if (signal?.aborted) throw signal.reason;
      console.warn("[cycle] DOL initial claims unavailable", error);
    }
  }
  if (definition.mirror) {
    try {
      const text = await responseText(
        `https://api.db.nomics.world/v22/series/${definition.mirror.path}?observations=1`,
        signal,
      );
      const parsed = parseFredMirror(JSON.parse(text) as unknown, definition, now);
      if (definition.mirror.subtractPath) {
        const other = { ...definition, mirror: { path: definition.mirror.subtractPath } };
        const otherText = await responseText(
          `https://api.db.nomics.world/v22/series/${other.mirror.path}?observations=1`,
          signal,
        );
        parsed.observations = subtractCycleObservations(
          parsed.observations,
          parseFredMirror(JSON.parse(otherText) as unknown, other, now).observations,
        );
        parsed.sourceUpdatedAt = null;
      }
      const series = buildFredCycleSeries(
        definition,
        parsed.observations,
        new Date().toISOString(),
        parsed.sourceUpdatedAt,
        true,
      );
      return definition.mirror.subtractPath
        ? {
            ...series,
            source: {
              ...series.source,
              name: "Federal Reserve Board · DBnomics 镜像",
              url: "https://www.federalreserve.gov/releases/h15/",
              seriesCode: `${definition.mirror.path} − ${definition.mirror.subtractPath}`,
            },
            note: `${series.note} 利差由两个 H.15 同日收益率相减；任一缺失则为空，不使用邻近日替代。`,
          }
        : series;
    } catch (error) {
      if (signal?.aborted) throw signal.reason;
      console.warn(`[cycle] ${definition.code} mirror unavailable`, error);
    }
  }
  throw new Error(`${definition.code} 的原始来源和可用镜像均失败`);
}

/** Bounded concurrency and partial success: unavailable sources never generate stand-in values. */
export async function fetchFredCycleSnapshot(signal?: AbortSignal): Promise<CycleSnapshot> {
  const series: CycleSeries[] = [];
  for (let offset = 0; offset < FRED_CYCLE_DEFINITIONS.length; offset += 3) {
    if (signal?.aborted) throw signal.reason;
    const results = await Promise.allSettled(
      FRED_CYCLE_DEFINITIONS.slice(offset, offset + 3).map((definition) =>
        fetchSeries(definition, signal),
      ),
    );
    for (const result of results) {
      if (result.status === "fulfilled") {
        if (result.value.observations.some((point) => point.value !== null))
          series.push(result.value);
      } else
        console.warn("[cycle] US source unavailable; preserving missing coverage", result.reason);
    }
  }
  if (signal?.aborted) throw signal.reason;
  if (!series.length) throw new Error("美国周期来源均不可用，请稍后重试；未生成替代数据。");
  return { version: 1, fetchedAt: new Date().toISOString(), series };
}
