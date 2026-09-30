import { RecordBatchStreamWriter, Table, tableFromArrays } from "apache-arrow";
import type { ResearchManifest } from "./model";

/** Synthetic weekday calendar, never presented as exchange history. Small enough to create locally. */
export function demoResearch(): { manifest: ResearchManifest; files: File[] } {
  const count = 64;
  const dates: number[] = [];
  const day = new Date("2024-01-02T00:00:00Z");
  while (dates.length < 180) {
    if (day.getUTCDay() !== 0 && day.getUTCDay() !== 6)
      dates.push(Number(day.toISOString().slice(0, 10).replaceAll("-", "")));
    day.setUTCDate(day.getUTCDate() + 1);
  }
  const instruments = Array.from({ length: count }, (_, id) => ({
    code: `sz.${String(1000 + id).padStart(6, "0")}`,
    limitRatio: 0.1,
  }));
  const industries = ["technology", "manufacturing", "ads", "consumer"];
  const files: File[] = [];
  let previous = Array.from({ length: count }, (_, id) => 8 + id * 0.28);
  for (let offset = 0; offset < dates.length; offset += 20) {
    const batches = [];
    for (let t = offset; t < Math.min(offset + 20, dates.length); t++) {
      const close = Float64Array.from({ length: count }, (_, id) => {
        const base = 8 + id * 0.28;
        return (
          base *
          (1 +
            0.0009 * t +
            0.075 * Math.sin(t / 11 + (id % 4) * 1.4) +
            0.015 * Math.cos(t / 5 + id))
        );
      });
      const open = Float64Array.from(close, (c, id) => (c + (previous[id] ?? c)) / 2);
      const table = tableFromArrays({
        date: new Uint32Array(count).fill(dates[t] ?? 0),
        id: Uint32Array.from({ length: count }, (_, id) => id),
        industry: Uint32Array.from({ length: count }, (_, id) => id % 4),
        open,
        high: Float64Array.from(close, (c, id) => Math.max(c, open[id] ?? c) * 1.01),
        low: Float64Array.from(close, (c, id) => Math.min(c, open[id] ?? c) * 0.99),
        close,
        preclose: Float64Array.from(previous),
        adjfactor: new Float64Array(count).fill(1),
        profit: Float64Array.from({ length: count }, (_, id) => (id % 13 === 0 ? -1e6 : 1e7)),
        shares: Float64Array.from(
          { length: count },
          (_, id) => 1e8 + ((id + Math.floor(t / 30)) % count) * 1e7,
        ),
        is_st: Uint8Array.from({ length: count }, (_, id) => (id % 17 === 0 ? 1 : 0)),
        tradable: new Uint8Array(count).fill(1),
        breadth_member: new Uint8Array(count).fill(1),
        selection_member: new Uint8Array(count).fill(1),
      });
      batches.push(...table.batches);
      previous = Array.from(close);
    }
    const bytes = RecordBatchStreamWriter.writeAll(new Table(batches)).toUint8Array(true);
    files.push(new File([bytes.slice().buffer], `daily-${String(offset).padStart(4, "0")}.arrow`));
  }
  const manifest: ResearchManifest = {
    version: 1,
    schema: "jsg-daily-v1",
    name: "JSG · 64 股演示",
    source: "Synthetic deterministic daily bars",
    universeMode: "synthetic",
    warnings: ["演示行情与交易日历为合成数据，仅用于验证工作流。"],
    startDate: dates[24] ?? 0,
    endDate: dates.at(-1) ?? 0,
    instruments,
    industries,
    calendar: dates.map((date, i) => {
      const weekday = new Date(
        `${String(date).slice(0, 4)}-${String(date).slice(4, 6)}-${String(date).slice(6, 8)}T00:00:00Z`,
      ).getUTCDay();
      return { date, rebalance: weekday === 5 && i >= 24 };
    }),
    partitions: files.map((file, i) => ({
      file: file.name,
      bytes: file.size,
      rows: Math.min(20, dates.length - i * 20) * count,
    })),
  };
  return {
    manifest,
    files: [
      new File([JSON.stringify(manifest)], "manifest.json", { type: "application/json" }),
      ...files,
    ],
  };
}
