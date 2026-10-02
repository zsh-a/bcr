import { validateBenchmark, type BenchmarkSnapshot } from "@bcr/market-data/research/benchmark";
import { numericDate } from "@bcr/market-data/research/clickhouse-http";
import { EVALUATION_VERSION, METRIC_CONVENTIONS } from "../execution/versions";
import { chunkData, type ResultSource, type ResultStorage } from "./result-data";

export interface ReturnStats {
  days: number;
  totalReturn: number;
  annualizedReturn: number;
  volatility: number;
  sharpe: number;
  maxDrawdown: number;
  downsideDeviation: number;
  sortino: number | null;
  calmar: number | null;
  winningDays: number;
  losingDays: number;
  winRate: number;
  profitFactor: number | null;
  avgWin: number;
  avgLoss: number;
}
export interface PeriodReturn {
  period: string;
  first: string;
  last: string;
  days: number;
  strategy: number;
  benchmark?: number;
  excess?: number;
}
export interface Evaluation {
  version: string;
  conventions: typeof METRIC_CONVENTIONS;
  strategy: ReturnStats;
  benchmark?: {
    name: string;
    kind: BenchmarkSnapshot["kind"];
    stats: ReturnStats;
    excessReturn: number;
    relativeReturn: number;
  };
  months: PeriodReturn[];
  years: PeriodReturn[];
  curve: { date: string; strategy: number; benchmark?: number }[];
  first: string;
  last: string;
}
class Accumulator {
  days = 0;
  mean = 0;
  m2 = 0;
  peak: number;
  worst = 0;
  previous: number;
  downsideSquares = 0;
  winningDays = 0;
  losingDays = 0;
  positivePnl = 0;
  negativePnl = 0;
  constructor(readonly initial: number) {
    this.previous = initial;
    this.peak = initial;
  }
  push(value: number) {
    if (!Number.isFinite(value) || value < 0 || (this.previous === 0 && value > 0))
      throw new Error("净值数据无效");
    const change = this.previous === 0 ? 0 : value / this.previous - 1;
    const pnl = value - this.previous;
    if (!Number.isFinite(change) || !Number.isFinite(pnl)) throw new Error("日收益超出计算范围");
    this.downsideSquares += Math.min(change, 0) ** 2;
    if (pnl > 0) {
      this.winningDays++;
      this.positivePnl += pnl;
    }
    if (pnl < 0) {
      this.losingDays++;
      this.negativePnl += pnl;
    }
    this.days++;
    const delta = change - this.mean;
    this.mean += delta / this.days;
    this.m2 += delta * (change - this.mean);
    this.peak = Math.max(this.peak, value);
    this.worst = Math.min(this.worst, value / this.peak - 1);
    this.previous = value;
  }
  finish(): ReturnStats {
    const variance = this.m2 / Math.max(1, this.days - 1),
      totalReturn = this.previous / this.initial - 1,
      annualizedReturn = Math.pow(1 + totalReturn, 252 / this.days) - 1,
      downsideDeviation = Math.sqrt(this.downsideSquares / this.days) * Math.sqrt(252);
    if (!Number.isFinite(annualizedReturn)) throw new Error("收益无法有限年化，请延长分析区间");
    const ratio = (numerator: number, denominator: number): number | null => {
      const value = numerator / denominator;
      return denominator > 0 && Number.isFinite(value) ? value : null;
    };
    return {
      days: this.days,
      totalReturn,
      annualizedReturn,
      volatility: Math.sqrt(Math.max(0, variance)) * Math.sqrt(252),
      sharpe: variance > 0 ? (this.mean / Math.sqrt(variance)) * Math.sqrt(252) : 0,
      maxDrawdown: this.worst,
      downsideDeviation,
      sortino: ratio(this.mean * 252, downsideDeviation),
      calmar: ratio(annualizedReturn, -this.worst),
      winningDays: this.winningDays,
      losingDays: this.losingDays,
      winRate: this.winningDays / this.days,
      profitFactor: ratio(this.positivePnl, -this.negativePnl),
      avgWin: this.winningDays ? this.positivePnl / this.winningDays : 0,
      avgLoss: this.losingDays ? this.negativePnl / this.losingDays : 0,
    };
  }
}
/** Scan complete result chunks once; previews never supply analysis observations. */
export async function evaluateResult(
  services: ResultStorage,
  result: ResultSource,
  capital: number,
  dates: string[],
  baselineDate: string,
  benchmark: BenchmarkSnapshot | undefined,
  signal: AbortSignal,
): Promise<Evaluation> {
  if (!Number.isFinite(capital) || capital <= 0 || !dates.length || dates.length > 20000)
    throw new Error("分析区间或本金无效");
  numericDate(baselineDate);
  dates.forEach((date, i) => {
    numericDate(date);
    if (date <= baselineDate || (i && date <= dates[i - 1]!)) throw new Error("分析交易日历无效");
  });
  const prices = benchmark
    ? new Map(validateBenchmark(benchmark).points.map((p) => [p.date, p.close]))
    : undefined;
  if (prices)
    for (const date of [baselineDate, ...dates])
      if (!prices.has(date)) throw new Error(`基准缺少交易日 ${date}，请补齐数据；不自动填充`);
  const strategy = new Accumulator(capital),
    base = prices ? new Accumulator(prices.get(baselineDate)!) : undefined;
  const months = new Map<string, PeriodReturn & { start: number; baseStart?: number }>(),
    years = new Map<string, PeriodReturn & { start: number; baseStart?: number }>();
  const buckets = new Map<
    number,
    {
      first: Evaluation["curve"][number];
      last: Evaluation["curve"][number];
      min: Evaluation["curve"][number];
      max: Evaluation["curve"][number];
      minBenchmark: Evaluation["curve"][number];
      maxBenchmark: Evaluation["curve"][number];
    }
  >();
  let processed = 0;
  const consume = (points: ResultSource["equity"]) => {
    for (const p of points) {
      if (p.date !== dates[processed]) throw new Error("结果交易日与冻结日历不一致");
      const previous = strategy.previous,
        basePrevious = base?.previous;
      strategy.push(p.equity);
      if (base) base.push(prices!.get(p.date)!);
      for (const [map, key] of [
        [months, p.date.slice(0, 7)],
        [years, p.date.slice(0, 4)],
      ] as const) {
        const period = map.get(key) ?? {
          period: key,
          first: p.date,
          last: p.date,
          days: 0,
          strategy: 0,
          start: previous,
          ...(basePrevious !== undefined ? { baseStart: basePrevious } : {}),
        };
        period.last = p.date;
        period.days++;
        period.strategy = period.start === 0 ? 0 : p.equity / period.start - 1;
        if (base && period.baseStart !== undefined) {
          period.benchmark = base.previous / period.baseStart - 1;
          period.excess = period.strategy - period.benchmark;
        }
        map.set(key, period);
      }
      const point = {
        date: p.date,
        strategy: p.equity / capital,
        ...(base ? { benchmark: base.previous / base.initial } : {}),
      };
      const key = Math.floor((processed * 512) / dates.length),
        bucket = buckets.get(key);
      if (!bucket)
        buckets.set(key, {
          first: point,
          last: point,
          min: point,
          max: point,
          minBenchmark: point,
          maxBenchmark: point,
        });
      else {
        bucket.last = point;
        if (point.strategy < bucket.min.strategy) bucket.min = point;
        if (point.strategy > bucket.max.strategy) bucket.max = point;
        if (point.benchmark !== undefined && point.benchmark < bucket.minBenchmark.benchmark!)
          bucket.minBenchmark = point;
        if (point.benchmark !== undefined && point.benchmark > bucket.maxBenchmark.benchmark!)
          bucket.maxBenchmark = point;
      }
      processed++;
    }
  };
  signal.throwIfAborted();
  if (result.chunks === undefined) consume(result.equity);
  else
    for (const chunk of result.chunks) {
      signal.throwIfAborted();
      const data = await chunkData(services, chunk.ref, signal);
      signal.throwIfAborted();
      consume(data.equity);
    }
  if (processed !== dates.length) throw new Error("完整结果缺少交易日，无法分析");
  const strip = (map: typeof months) =>
    [...map.values()].map(({ start: _start, baseStart: _baseStart, ...period }) => period);
  const stats = strategy.finish(),
    baseStats = base?.finish();
  const curve = [
    ...new Map(
      [...buckets.values()]
        .flatMap((b) => [b.first, b.min, b.max, b.minBenchmark, b.maxBenchmark, b.last])
        .map((p) => [p.date, p]),
    ).values(),
  ].sort((a, b) => a.date.localeCompare(b.date));
  const analysis: Evaluation = {
    version: EVALUATION_VERSION,
    conventions: METRIC_CONVENTIONS,
    strategy: stats,
    months: strip(months),
    years: strip(years),
    curve,
    first: dates[0]!,
    last: dates.at(-1)!,
  };
  if (benchmark && baseStats)
    analysis.benchmark = {
      name: benchmark.name,
      kind: benchmark.kind,
      stats: baseStats,
      excessReturn: stats.totalReturn - baseStats.totalReturn,
      relativeReturn: (1 + stats.totalReturn) / (1 + baseStats.totalReturn) - 1,
    };
  if (
    [stats, baseStats].some(
      (s) => s && Object.values(s).some((v) => v !== null && !Number.isFinite(v)),
    )
  )
    throw new Error("分析指标溢出");
  signal.throwIfAborted();
  return analysis;
}
