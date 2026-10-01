import { contentHash, type ArtifactRef, type RuntimeServices } from "@bcr/core";
import { Effect } from "effect";
import {
  numericDate,
  normalizeConnection,
  clickHouseClient,
  type ClickHouseConnection,
} from "./clickhouse-http";
import { dateText, type ResearchManifest } from "./model";

export type BenchmarkKind = "price" | "total-return";
export interface BenchmarkSnapshot {
  version: 1;
  name: string;
  kind: BenchmarkKind;
  source: string;
  acquiredAt: string;
  points: { date: string; close: number }[];
}
export interface BenchmarkBinding {
  ref: ArtifactRef;
  name: string;
  kind: BenchmarkKind;
  acquiredAt: string;
}
export const BENCHMARK_SQL =
  "SELECT toString(trading_date) AS date,toFloat64(close_value) AS close FROM (SELECT date AS trading_date,close AS close_value FROM stock_daily FINAL WHERE code={code:String} AND date BETWEEN {start:Date} AND {end:Date} ORDER BY date LIMIT 20001) ORDER BY trading_date";
export function benchmarkBaseline(manifest: ResearchManifest): string {
  const day = manifest.calendar.filter((s) => s.date < manifest.startDate).at(-1);
  if (!day) throw new Error("基准比较需要回测开始前一个交易日");
  return dateText(day.date);
}
export function validateBenchmark(value: unknown): BenchmarkSnapshot {
  const b = value as BenchmarkSnapshot;
  if (
    !b ||
    b.version !== 1 ||
    !["price", "total-return"].includes(b.kind) ||
    typeof b.name !== "string" ||
    !b.name.trim() ||
    b.name.length > 120 ||
    typeof b.source !== "string" ||
    b.source.length > 2000 ||
    typeof b.acquiredAt !== "string" ||
    !Number.isFinite(Date.parse(b.acquiredAt)) ||
    !Array.isArray(b.points) ||
    b.points.length < 2 ||
    b.points.length > 20000
  )
    throw new Error("基准数据格式无效");
  for (const [i, p] of b.points.entries()) {
    numericDate(p.date);
    if (
      !Number.isFinite(p.close) ||
      p.close <= 0 ||
      p.close > 1e15 ||
      (i && p.date <= b.points[i - 1]!.date)
    )
      throw new Error("基准日期需严格递增，收盘值需为正数");
  }
  return b;
}
export function validateBenchmarkCoverage(b: BenchmarkSnapshot, manifest: ResearchManifest) {
  const dates = new Set(b.points.map((p) => p.date));
  for (const date of [
    benchmarkBaseline(manifest),
    ...manifest.calendar
      .filter((s) => s.date >= manifest.startDate && s.date <= manifest.endDate)
      .map((s) => dateText(s.date)),
  ])
    if (!dates.has(date)) throw new Error(`基准缺少交易日 ${date}，请补齐数据；不自动填充`);
}
export function parseBenchmarkCsv(
  text: string,
  name: string,
  kind: BenchmarkKind,
): BenchmarkSnapshot {
  if (new TextEncoder().encode(text).length > 2 * 1024 * 1024)
    throw new Error("基准 CSV 超过 2 MiB");
  const lines = text
    .replace(/^\uFEFF/u, "")
    .trim()
    .split(/\r?\n/u);
  if (lines.shift()?.trim() !== "date,close") throw new Error("CSV 表头应为 date,close");
  const points = lines.map((line) => {
    const cells = line.split(",").map((s) => s.trim());
    if (cells.length !== 2 || !/^(?:\d+(?:\.\d+)?|\.\d+)$/u.test(cells[1]!))
      throw new Error("CSV 每行应为 YYYY-MM-DD,收盘值");
    return { date: cells[0]!, close: Number(cells[1]) };
  });
  return validateBenchmark({
    version: 1,
    name: name.trim(),
    kind,
    source: "CSV import",
    acquiredAt: new Date().toISOString(),
    points,
  });
}
export async function fetchBenchmark(
  connection: ClickHouseConnection,
  code: string,
  manifest: ResearchManifest,
  signal: AbortSignal,
): Promise<BenchmarkSnapshot> {
  if (!/^(sh|sz)\.\d{6}$/u.test(code)) throw new Error("指数代码应为 sh.000300 或 sz.399300 格式");
  const c = normalizeConnection(connection);
  const rows = await clickHouseClient(c).json(
    BENCHMARK_SQL,
    { code, start: benchmarkBaseline(manifest), end: dateText(manifest.endDate) },
    signal,
  );
  const snapshot = validateBenchmark({
    version: 1,
    name: code === "sh.000300" ? "沪深300" : code,
    kind: "price",
    source: `ClickHouse ${c.url} / ${c.database} / stock_daily / ${code}`,
    acquiredAt: new Date().toISOString(),
    points: rows.map((row) => ({ date: row["date"], close: row["close"] })),
  });
  validateBenchmarkCoverage(snapshot, manifest);
  return snapshot;
}
export async function saveBenchmark(
  services: Pick<RuntimeServices, "artifacts">,
  snapshot: BenchmarkSnapshot,
): Promise<BenchmarkBinding> {
  validateBenchmark(snapshot);
  const bytes = new TextEncoder().encode(JSON.stringify(snapshot)),
    hash = contentHash(bytes);
  const ref: ArtifactRef = {
    id: `jsg/benchmark/${hash}`,
    hash,
    type: "quant/jsg-benchmark",
    format: "json",
    storage: "opfs",
  };
  if (!(await Effect.runPromise(services.artifacts.has(ref))))
    await Effect.runPromise(services.artifacts.put(ref, bytes));
  return { ref, name: snapshot.name, kind: snapshot.kind, acquiredAt: snapshot.acquiredAt };
}
export async function readBenchmark(
  services: { artifacts: Pick<RuntimeServices["artifacts"], "get"> },
  binding: BenchmarkBinding,
) {
  if (binding.ref.type !== "quant/jsg-benchmark") throw new Error("基准引用无效");
  const bytes = await Effect.runPromise(services.artifacts.get(binding.ref));
  const b = validateBenchmark(JSON.parse(new TextDecoder().decode(bytes)));
  if (b.name !== binding.name || b.kind !== binding.kind || b.acquiredAt !== binding.acquiredAt)
    throw new Error("基准引用与数据不一致");
  return b;
}
