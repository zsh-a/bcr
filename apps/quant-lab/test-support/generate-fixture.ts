import { RecordBatchStreamWriter, Table, tableFromArrays } from "apache-arrow";
import {
  MAX_PARTITION_BYTES,
  parseManifest,
  type ResearchManifest,
} from "@bcr/market-data/research/model";

/** Deterministic, bounded fixtures. Each callback owns just one Arrow partition. */
export async function generateFixture(
  options: { instruments: number; sessions: number; batchDays: number },
  write: (name: string, bytes: Uint8Array) => Promise<void>,
): Promise<ResearchManifest> {
  const { instruments: count, sessions, batchDays } = options;
  if (
    !Number.isInteger(count) ||
    count < 32 ||
    count > 20_000 ||
    !Number.isInteger(sessions) ||
    sessions < 60 ||
    sessions > 20_000 ||
    !Number.isInteger(batchDays) ||
    batchDays < 1 ||
    batchDays > 20
  )
    throw new Error(
      "Fixture requires 32–20,000 instruments, 60–20,000 sessions and 1–20 batch days",
    );
  const dates: number[] = [];
  const day = new Date("2010-01-04T00:00:00Z");
  while (dates.length < sessions) {
    if (day.getUTCDay() !== 0 && day.getUTCDay() !== 6)
      dates.push(Number(day.toISOString().slice(0, 10).replaceAll("-", "")));
    day.setUTCDate(day.getUTCDate() + 1);
  }
  const industries = Array.from({ length: 12 }, (_, i) => `sector-${i}`);
  let previous = Float64Array.from({ length: count }, (_, id) => 8 + (id % 100) * 0.08);
  const partitions: ResearchManifest["partitions"] = [];
  for (let offset = 0; offset < sessions; offset += batchDays) {
    const batches = [];
    for (let t = offset; t < Math.min(offset + batchDays, sessions); t++) {
      const close = Float64Array.from(
        { length: count },
        (_, id) =>
          (8 + (id % 100) * 0.08) *
          (1 + 0.0001 * t + 0.1 * Math.sin(t / 13 + (id % 12) * 0.6) + 0.01 * Math.cos(t / 7 + id)),
      );
      const open = Float64Array.from(close, (c, id) => (c + previous[id]!) / 2);
      const table = tableFromArrays({
        date: new Uint32Array(count).fill(dates[t]!),
        id: Uint32Array.from({ length: count }, (_, id) => id),
        industry: Uint32Array.from({ length: count }, (_, id) => id % industries.length),
        open,
        high: Float64Array.from(close, (c, id) => Math.max(c, open[id]!) * 1.01),
        low: Float64Array.from(close, (c, id) => Math.min(c, open[id]!) * 0.99),
        close,
        preclose: previous,
        adjfactor: new Float64Array(count).fill(1),
        profit: Float64Array.from({ length: count }, (_, id) => (id % 31 === 0 ? -1e6 : 1e7)),
        shares: Float64Array.from(
          { length: count },
          (_, id) => 1e8 + ((id + Math.floor(t / 15)) % count) * 1e6,
        ),
        is_st: Uint8Array.from({ length: count }, (_, id) => (id % 71 === 0 ? 1 : 0)),
        tradable: new Uint8Array(count).fill(1),
        breadth_member: new Uint8Array(count).fill(1),
        selection_member: new Uint8Array(count).fill(1),
      });
      batches.push(...table.batches);
      previous = close;
    }
    const bytes = RecordBatchStreamWriter.writeAll(new Table(batches)).toUint8Array(true);
    if (bytes.byteLength > MAX_PARTITION_BYTES)
      throw new Error("Partition exceeds 32 MiB; reduce batch days");
    const file = `daily-${String(offset).padStart(5, "0")}.arrow`;
    await write(file, bytes);
    partitions.push({
      file,
      bytes: bytes.byteLength,
      rows: Math.min(batchDays, sessions - offset) * count,
    });
  }
  return parseManifest({
    version: 1,
    schema: "jsg-daily-v1",
    name: `JSG throughput · ${count} × ${sessions}`,
    source: "Deterministic synthetic fixture v1",
    universeMode: "synthetic",
    warnings: ["合成行情与工作日日历，仅用于性能及一致性验证。"],
    startDate: dates[30],
    endDate: dates.at(-1),
    instruments: Array.from({ length: count }, (_, id) => ({
      code: `sz.${String(1000 + id).padStart(6, "0")}`,
      limitRatio: 0.1,
    })),
    industries,
    calendar: dates.map((date, i) => ({ date, rebalance: i >= 30 && i % 5 === 4 })),
    partitions,
  });
}
