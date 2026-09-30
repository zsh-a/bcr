import type { ArtifactRef } from "@bcr/core";

export const MAX_PARTITION_BYTES = 32 * 1024 * 1024;
export const MAX_MANIFEST_BYTES = 4 * 1024 * 1024;
export const MODEL = "jsg-adjusted-v1";
export interface JsgConfig {
  initialCapital: number;
  poolSize: number;
  stockCount: number;
  commissionBps: number;
  slippageBps: number;
  stopLoss: number;
  trailingStop: number;
  maxDrawdown: number;
  tPlusOne: boolean;
  industryBlacklist: string[];
}
export const DEFAULT_CONFIG: JsgConfig = {
  initialCapital: 1_000_000,
  poolSize: 20,
  stockCount: 10,
  commissionBps: 3,
  slippageBps: 10,
  stopLoss: 0,
  trailingStop: 0,
  maxDrawdown: 0,
  tPlusOne: false,
  industryBlacklist: ["ads"],
};
export interface ResearchManifest {
  version: 1;
  schema: "jsg-daily-v1";
  name: string;
  source: string;
  universeMode: "historical" | "snapshot" | "synthetic";
  warnings: string[];
  startDate: number;
  endDate: number;
  instruments: { code: string; limitRatio: number }[];
  industries: string[];
  calendar: { date: number; rebalance: boolean }[];
  partitions: { file: string; bytes: number; rows: number }[];
}
export interface ResearchDataset {
  manifest: ResearchManifest;
  manifestRef: ArtifactRef;
  partitions: ArtifactRef[];
}
export interface JsgResult {
  metrics: {
    engine: string;
    model: string;
    finalEquity: number;
    totalReturn: number;
    annualizedReturn: number;
    sharpe: number;
    maxDrawdown: number;
    filledOrders: number;
    rejectedOrders: number;
    fees: number;
    days: number;
  };
  equity: { date: string; equity: number; cash: number; drawdown: number; holdings: number }[];
  orders: {
    date: string;
    signalDate: string;
    code: string;
    side: string;
    timing: string;
    reason: string;
    requested: number;
    quantity: number;
    price: number;
    fee: number;
    status: string;
  }[];
  holdings: { code: string; quantity: number; averageCost: number; price: number; value: number }[];
  decisions: { date: string; topIndustry: string | null; breadth: number; targets: string[] }[];
  pendingOrders: number;
  warnings: string[];
}
function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new Error("研究清单必须是对象");
  return value as Record<string, unknown>;
}
function array(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new Error("研究清单缺少数组字段");
  return value as unknown[];
}
function text(value: unknown): string {
  if (typeof value !== "string" || value.length > 2000) throw new Error("研究清单文本字段无效");
  return value;
}
function integer(value: unknown, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max)
    throw new Error("研究清单数值超出范围");
  return value;
}
export function dateText(date: number): string {
  const value = String(date);
  return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
}
function dateValue(value: unknown): number {
  const number = integer(value, 19000101, 22001231);
  const parsed = new Date(`${dateText(number)}T00:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== dateText(number))
    throw new Error("交易日期无效");
  return number;
}
/** Parse untrusted portable manifests before copying any binary files. Rust validates again. */
export function parseManifest(value: unknown): ResearchManifest {
  const m = record(value);
  if (m["version"] !== 1 || m["schema"] !== "jsg-daily-v1")
    throw new Error("不支持的 JSG 数据版本");
  const mode = m["universeMode"];
  if (mode !== "snapshot" && mode !== "historical" && mode !== "synthetic")
    throw new Error("缺少成分股历史模式");
  const instruments = array(m["instruments"]).map((v) => {
    const i = record(v);
    const ratio = i["limitRatio"];
    if (typeof ratio !== "number" || !Number.isFinite(ratio) || ratio < 0 || ratio > 0.3)
      throw new Error("涨跌停比例无效");
    const code = text(i["code"]);
    if (code.length === 0) throw new Error("证券代码为空");
    return { code, limitRatio: ratio };
  });
  const industries = array(m["industries"]).map(text);
  if (
    instruments.length === 0 ||
    instruments.length > 20_000 ||
    industries.length === 0 ||
    industries.length > 20_000 ||
    industries.some((name) => name.length === 0) ||
    new Set(industries).size !== industries.length ||
    new Set(instruments.map((i) => i.code)).size !== instruments.length
  )
    throw new Error("证券或行业维度无效");
  let previous = 0;
  const calendar = array(m["calendar"]).map((v) => {
    const s = record(v);
    const date = dateValue(s["date"]);
    if (date <= previous || typeof s["rebalance"] !== "boolean")
      throw new Error("交易日历必须递增且包含调仓标记");
    previous = date;
    return { date, rebalance: s["rebalance"] };
  });
  const startDate = dateValue(m["startDate"]);
  const endDate = dateValue(m["endDate"]);
  if (
    calendar.length === 0 ||
    calendar.length > 20_000 ||
    !calendar.some((s) => s.date === startDate) ||
    calendar.at(-1)?.date !== endDate ||
    startDate > endDate
  )
    throw new Error("回测日期范围与日历不一致");
  const names = new Set<string>();
  const partitions = array(m["partitions"]).map((v) => {
    const p = record(v);
    const file = text(p["file"]);
    if (!/^[^/\\]+\.arrow$/u.test(file) || names.has(file))
      throw new Error("Arrow 分片文件名重复或无效");
    names.add(file);
    return {
      file,
      bytes: integer(p["bytes"], 1, MAX_PARTITION_BYTES),
      rows: integer(p["rows"], 1, 400_000_000),
    };
  });
  if (partitions.length === 0 || partitions.length > calendar.length)
    throw new Error("分片数量无效");
  const warnings = array(m["warnings"]).map(text);
  if (warnings.length > 100) throw new Error("数据警告过多");
  return {
    version: 1,
    schema: "jsg-daily-v1",
    name: text(m["name"]),
    source: text(m["source"]),
    universeMode: mode,
    warnings,
    startDate,
    endDate,
    instruments,
    industries,
    calendar,
    partitions,
  };
}
export function validateConfig(config: JsgConfig): void {
  if (
    !Number.isFinite(config.initialCapital) ||
    config.initialCapital <= 0 ||
    config.initialCapital > 1e15 ||
    !Number.isSafeInteger(config.poolSize) ||
    config.poolSize < 1 ||
    config.poolSize > 20_000 ||
    !Number.isSafeInteger(config.stockCount) ||
    config.stockCount < 1 ||
    config.stockCount > config.poolSize ||
    typeof config.tPlusOne !== "boolean" ||
    !Array.isArray(config.industryBlacklist) ||
    config.industryBlacklist.some((s) => typeof s !== "string")
  )
    throw new Error("本金、股票数或候选池参数无效");
  for (const bps of [config.commissionBps, config.slippageBps]) {
    if (!Number.isFinite(bps) || bps < 0 || bps > 100)
      throw new Error("费率或滑点应在 0–100 bps 内");
  }
  for (const risk of [config.stopLoss, config.trailingStop, config.maxDrawdown]) {
    if (!Number.isFinite(risk) || risk < 0 || risk >= 1)
      throw new Error("风控比例应在 0–100% 内，0 为关闭");
  }
}
