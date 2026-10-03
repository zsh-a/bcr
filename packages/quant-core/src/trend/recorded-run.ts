import type { ArtifactRef } from "@bcr/core";
import {
  validateBinanceManifest,
  type BinanceDataset,
  type BinanceManifest,
} from "@bcr/market-data/binance/model";
import { validateRecordedTrendConfig } from "./archive";
import type { TrendRun } from "./model";

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label}无效`);
  return value as Record<string, unknown>;
}
const text = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;
const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);
const count = (value: unknown): value is number =>
  finite(value) && Number.isSafeInteger(value) && value >= 0;

function reference(value: unknown, label: string, type?: string): ArtifactRef {
  const ref = object(value, label);
  if (
    !text(ref.id) ||
    !text(ref.type) ||
    (type !== undefined && ref.type !== type) ||
    !["memory", "shared-memory", "opfs"].includes(ref.storage as string) ||
    (ref.format !== undefined && !text(ref.format)) ||
    (type !== undefined && ref.format !== undefined && ref.format !== "json") ||
    (ref.port !== undefined && !text(ref.port)) ||
    (ref.hash !== undefined && (typeof ref.hash !== "string" || !/^[a-f0-9]{64}$/u.test(ref.hash)))
  )
    throw new Error(`${label}不完整或无效`);
  return value as ArtifactRef;
}

/** Validate references as well as manifest contents before a saved dataset can be reused. */
export function decodeRecordedTrendDataset(value: unknown): BinanceDataset {
  const dataset = object(value, "本地趋势行情记录");
  reference(dataset.manifestRef, "行情清单引用", "market/binance-manifest");
  const manifest = object(dataset.manifest, "行情清单") as unknown as BinanceManifest;
  validateBinanceManifest(manifest);
  reference(manifest.funding, "资金费引用");
  for (const partition of manifest.partitions) {
    reference(partition.candles, "成交价分片引用");
    reference(partition.marks, "标记价格分片引用");
    for (const repair of partition.repairs ?? []) {
      reference(repair.original, "原始档案引用");
      for (const day of repair.days) reference(day.ref, "修复档案引用");
    }
  }
  return value as BinanceDataset;
}

/** Read the historical envelope without rewriting configs, metrics, or optional legacy fields. */
export function decodeRecordedTrendRun(value: unknown): TrendRun {
  const run = object(value, "本地趋势运行记录");
  if (
    !text(run.id) ||
    !text(run.createdAt) ||
    !Number.isFinite(Date.parse(run.createdAt)) ||
    !finite(run.durationMs) ||
    run.durationMs < 0 ||
    typeof run.cached !== "boolean"
  )
    throw new Error("本地趋势运行信息不完整或无效");
  validateRecordedTrendConfig(run.config);
  decodeRecordedTrendDataset(run.dataset);
  reference(run.resultRef, "回测结果引用", "quant/trend-result");
  const metrics = object(run.metrics, "历史回测指标");
  for (const key of ["finalEquity", "totalReturn", "maxDrawdown", "fees", "funding"])
    if (!finite(metrics[key])) throw new Error(`历史回测指标 ${key} 无效`);
  for (const key of [
    "trades",
    "wins",
    "losses",
    "longestLossStreak",
    "rejectedSignals",
    "fundingEvents",
    "rows",
  ])
    if (!count(metrics[key])) throw new Error(`历史回测指标 ${key} 无效`);
  for (const key of ["winRate", "profitFactor", "meanR"])
    if (metrics[key] !== null && !finite(metrics[key])) throw new Error(`历史回测指标 ${key} 无效`);
  if (metrics.context !== undefined) {
    const context = object(metrics.context, "历史背景指标");
    for (const key of ["evaluated", "allowed", "rejected"])
      if (!count(context[key])) throw new Error(`历史背景指标 ${key} 无效`);
    if (Object.values(object(context.reasons, "历史背景原因")).some((value) => !count(value)))
      throw new Error("历史背景原因计数无效");
  }
  return value as TrendRun;
}
