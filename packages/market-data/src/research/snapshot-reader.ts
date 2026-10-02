import { artifactPath } from "@bcr/core";
import type { BinaryStore } from "@bcr/storage-opfs";
import initQuant, { snapshot_bars } from "../../../../crates/quant/pkg/bcr_quant.js";
import {
  MAX_PARTITION_BYTES,
  dateText,
  dateValue,
  type ResearchDataset,
  type SnapshotPartitionRange,
} from "./model";

export interface SnapshotBar {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  factor: number;
  volume: number | null;
  tradable: boolean;
}
let ready: Promise<unknown> | undefined;
/** Never falls back to a live quote or a synthetic candle. The run owns its input bytes. */
export async function readSnapshotBars(
  store: BinaryStore,
  dataset: ResearchDataset,
  code: string,
  from: number,
  to: number,
  signal: AbortSignal,
  ranges: SnapshotPartitionRange[] = [],
): Promise<SnapshotBar[]> {
  const id = dataset.manifest.instruments.findIndex((i) => i.code === code);
  if (id < 0) throw new Error("该证券不在本次回测快照中");
  signal.throwIfAborted();
  ready ??= initQuant().catch((error: unknown) => {
    ready = undefined;
    throw error;
  });
  await ready;
  const bars: SnapshotBar[] = [];
  for (const [index, ref] of dataset.partitions.entries()) {
    signal.throwIfAborted();
    const range = ranges[index];
    if (range && range.ref.id === ref.id && range.ref.hash === ref.hash) {
      dateValue(range.from);
      dateValue(range.to);
      if (range.from > range.to) throw new Error("回测分片日期索引无效");
      if (range.to < from || range.from > to) continue;
    }
    const path = artifactPath(ref);
    const size = await store.size(path);
    if (!size || size > MAX_PARTITION_BYTES || size !== dataset.manifest.partitions[index]?.bytes)
      throw new Error("回测行情快照缺失或分片大小不符，请重新导入数据");
    const bytes = await store.get(path);
    signal.throwIfAborted();
    if (!bytes) throw new Error("回测行情快照已移除");
    bars.push(...(JSON.parse(snapshot_bars(bytes, id, from, to)) as SnapshotBar[]));
    if (bars.length > dataset.manifest.calendar.length) throw new Error("快照行情包含重复日期");
    // Let cancellation and other result requests run between bounded Arrow partitions.
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  const dates = new Set(dataset.manifest.calendar.map((d) => dateText(d.date)));
  let previous = "";
  for (const bar of bars) {
    if (bar.date <= previous || !dates.has(bar.date))
      throw new Error("快照行情日期与回测日历不一致");
    previous = bar.date;
  }
  signal.throwIfAborted();
  return bars;
}
