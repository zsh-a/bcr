import type { ArtifactRef } from "@bcr/core";
import type { ClickHouseProfile } from "./clickhouse-http";
import { parseDisplayNames, type DisplayNames } from "./display-names";
export const MAX_PARTITION_BYTES = 32 * 1024 * 1024;
export const MAX_MANIFEST_BYTES = 4 * 1024 * 1024;
export interface CorporateAction {
  id: number;
  recordDate: number;
  exDate: number;
  payDate: number;
  shareAvailableDate: number;
  knownDate: number;
  cashPerShare: number;
  withholdingPerShare: number;
  shareRatio: number;
  fractionalCashPrice: number;
}
export interface DataQuality {
  membership: "historical" | "snapshot";
  financials: "revisions" | "latest";
  corporateActions: "complete" | "missing";
  priceLimits: "daily" | "static";
}
export interface ResearchManifest {
  displayNames?: DisplayNames;
  version: 1 | 2;
  schema: "jsg-daily-v1" | "jsg-daily-v2";
  corporateActions?: CorporateAction[];
  dataQuality?: DataQuality;
  name: string;
  source: string;
  universeMode: "historical" | "snapshot" | "synthetic";
  warnings: string[];
  startDate: number;
  endDate: number;
  instruments: { code: string; limitRatio: number }[];
  industries: string[];
  calendar: { date: number; rebalance: boolean; monthEnd?: boolean }[];
  partitions: { file: string; bytes: number; rows: number }[];
}
export interface ResearchDataset {
  snapshot?: {
    request?: ClickHouseProfile;
    createdAt: string;
    sourceLastDate?: string;
    timings?: Record<string, number>;
    reusedPartitions?: number;
    downloadedPartitions?: number;
  };
  manifest: ResearchManifest;
  manifestRef: ArtifactRef;
  partitions: ArtifactRef[];
}
/** Derived by a validated replay, bound to the immutable input artifact. */
export interface SnapshotPartitionRange {
  ref: ArtifactRef;
  from: number;
  to: number;
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
export function dateValue(value: unknown): number {
  const number = integer(value, 19000101, 22001231);
  const parsed = new Date(`${dateText(number)}T00:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== dateText(number))
    throw new Error("交易日期无效");
  return number;
}
/** Parse untrusted portable manifests before copying any binary files. Rust validates again. */
export function parseManifest(value: unknown): ResearchManifest {
  const m = record(value);
  if (
    !(
      (m["version"] === 1 && m["schema"] === "jsg-daily-v1") ||
      (m["version"] === 2 && m["schema"] === "jsg-daily-v2")
    )
  )
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
    if (s["monthEnd"] !== undefined && typeof s["monthEnd"] !== "boolean")
      throw new Error("月末标记必须为布尔值");
    return {
      date,
      rebalance: s["rebalance"],
      ...(s["monthEnd"] !== undefined ? { monthEnd: s["monthEnd"] as boolean } : {}),
    };
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
  const extras: Pick<ResearchManifest, "corporateActions" | "dataQuality"> = {};
  if (m["version"] === 2) {
    const q = record(m["dataQuality"]);
    if (
      !["historical", "snapshot"].includes(String(q["membership"])) ||
      !["revisions", "latest"].includes(String(q["financials"])) ||
      !["complete", "missing"].includes(String(q["corporateActions"])) ||
      !["daily", "static"].includes(String(q["priceLimits"]))
    )
      throw new Error("v2 数据覆盖声明无效");
    extras.dataQuality = q as unknown as DataQuality;
    const keys = new Set<string>();
    extras.corporateActions = array(m["corporateActions"] ?? []).map((v) => {
      const a = record(v);
      const id = integer(a["id"], 0, instruments.length - 1);
      const recordDate = dateValue(a["recordDate"]),
        exDate = dateValue(a["exDate"]),
        payDate = dateValue(a["payDate"]),
        shareAvailableDate = dateValue(a["shareAvailableDate"]),
        knownDate = dateValue(a["knownDate"]);
      const numbers = [
        "cashPerShare",
        "withholdingPerShare",
        "shareRatio",
        "fractionalCashPrice",
      ].map((k) => {
        const n = a[k];
        if (typeof n !== "number" || !Number.isFinite(n) || n < 0 || n > 1e6)
          throw new Error("公司行为数值无效");
        return n;
      });
      const key = `${id}:${exDate}`;
      if (
        keys.has(key) ||
        recordDate >= exDate ||
        knownDate > recordDate ||
        payDate < exDate ||
        shareAvailableDate < exDate ||
        numbers[1]! > numbers[0]!
      )
        throw new Error("公司行为日期或重复事件无效");
      keys.add(key);
      return {
        id,
        recordDate,
        exDate,
        payDate,
        shareAvailableDate,
        knownDate,
        cashPerShare: numbers[0]!,
        withholdingPerShare: numbers[1]!,
        shareRatio: numbers[2]!,
        fractionalCashPrice: numbers[3]!,
      };
    });
    if (extras.corporateActions.length > 20_000) throw new Error("公司行为事件过多");
  }
  return {
    ...extras,
    ...(m["displayNames"] !== undefined
      ? {
          displayNames: subsetManifestNames(m["displayNames"], instruments, industries),
        }
      : {}),
    version: m["version"] as 1 | 2,
    schema: m["schema"] as ResearchManifest["schema"],
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
function subsetManifestNames(
  value: unknown,
  instruments: ResearchManifest["instruments"],
  industries: string[],
) {
  const names = parseDisplayNames(value);
  const codes = new Set(instruments.map((instrument) => instrument.code));
  const sectors = new Set(industries);
  if (
    Object.keys(names.instruments).some((code) => !codes.has(code)) ||
    Object.keys(names.industries).some((code) => !sectors.has(code))
  )
    throw new Error("名称代码不属于研究清单");
  return names;
}
