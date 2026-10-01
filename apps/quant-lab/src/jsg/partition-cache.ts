import { artifactPath, contentHash, type ArtifactRef } from "@bcr/core";
import type { BinaryStore } from "@bcr/storage-opfs";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
export const cacheIdentity = (value: unknown) => contentHash(encoder.encode(JSON.stringify(value)));
export interface PartitionRecord {
  version: 1;
  ref: ArtifactRef;
  bytes: number;
  rows: number;
  dates: string[];
}
export async function readSmallRecord<T>(store: BinaryStore, path: string): Promise<T | undefined> {
  if (((await store.size(path)) ?? Infinity) > 64 * 1024) return;
  try {
    const bytes = await store.get(path);
    return bytes ? (JSON.parse(decoder.decode(bytes)) as T) : undefined;
  } catch {
    return;
  }
}
export async function readPartition(
  store: BinaryStore,
  path: string,
  dates: string[],
): Promise<PartitionRecord | undefined> {
  const record = await readSmallRecord<PartitionRecord>(store, path);
  if (
    !record ||
    record.version !== 1 ||
    !Array.isArray(record.dates) ||
    record.dates.join() !== dates.join() ||
    !record.ref ||
    record.ref.storage !== "opfs" ||
    record.ref.type !== "quant/jsg-daily" ||
    typeof record.ref.id !== "string" ||
    !record.ref.id.startsWith("jsg/") ||
    !Number.isSafeInteger(record.bytes) ||
    record.bytes <= 0 ||
    record.bytes > 32 * 1024 * 1024 ||
    !Number.isSafeInteger(record.rows) ||
    record.rows <= 0 ||
    (await store.size(artifactPath(record.ref))) !== record.bytes
  )
    return;
  return record;
}
/** Align windows with the full calendar, independently of the selected backtest start. */
export function calendarWindow(
  allDates: string[],
  dates: string[],
  offset: number,
  batchDays: number,
) {
  const absolute = allDates.indexOf(dates[offset]!);
  if (absolute < 0) throw new Error("分片日期不在完整交易日历中");
  return dates.slice(offset, offset + Math.min(batchDays, 20 - (absolute % 20)));
}
