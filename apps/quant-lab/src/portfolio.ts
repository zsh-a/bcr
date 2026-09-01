import type {
  CorrelationMatrix,
  PortfolioAnalysis,
  PortfolioBacktestResult,
  PortfolioEquityPoint,
  PortfolioMetrics,
  PortfolioSeries,
  PortfolioWeight,
} from "./model";

const DAY_MS = 86_400_000;
const TRADING_DAYS = 252;

interface AlignedPortfolioData {
  readonly dates: ReadonlyArray<string>;
  readonly closes: ReadonlyArray<ReadonlyArray<number>>;
  readonly returns: ReadonlyArray<ReadonlyArray<number>>;
}

function mean(values: ReadonlyArray<number>): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function standardDeviation(values: ReadonlyArray<number>): number {
  if (values.length < 2) return 0;
  const average = mean(values);
  return Math.sqrt(
    values.reduce((sum, value) => sum + (value - average) ** 2, 0) / (values.length - 1),
  );
}

function portfolioYears(dates: ReadonlyArray<string>): number {
  const first = dates[0];
  const last = dates.at(-1);
  if (first === undefined || last === undefined) return 0;
  return Math.max(1 / TRADING_DAYS, (Date.parse(last) - Date.parse(first)) / (365.25 * DAY_MS));
}

function clampCorrelation(value: number): number {
  return Math.max(-1, Math.min(1, value));
}

function mapSeriesCloses(series: PortfolioSeries): Map<string, number> {
  const closes = new Map<string, number>();
  for (const bar of series.bars) {
    const timestamp = bar.date.length === 0 ? Number.NaN : Date.parse(bar.date);
    if (!Number.isFinite(timestamp)) continue;
    if (!Number.isFinite(bar.close) || bar.close <= 0) continue;
    const date = new Date(timestamp).toISOString().slice(0, 10);
    if (closes.has(date)) throw new Error(`${series.symbol} has duplicate date ${date}`);
    closes.set(date, bar.close);
  }
  return closes;
}

/**
 * Aligns every series to the dates shared by the complete portfolio.  This
 * avoids silently comparing different calendars (for example, CN holidays
 * against US sessions) and gives both the matrix and backtest one contract.
 */
export function alignPortfolioSeries(series: ReadonlyArray<PortfolioSeries>): AlignedPortfolioData {
  if (series.length === 0) throw new Error("portfolio needs at least one series");
  const closeMaps = series.map(mapSeriesCloses);
  const first = closeMaps[0];
  if (first === undefined || first.size === 0) {
    throw new Error("portfolio first series has no valid closing prices");
  }
  const dates = [...first.keys()]
    .filter((date) => closeMaps.every((closes) => closes.has(date)))
    .sort((left, right) => left.localeCompare(right));
  if (dates.length < 2) {
    throw new Error("portfolio series have fewer than two overlapping observations");
  }
  const closes = series.map((_, seriesIndex) =>
    dates.map((date) => closeMaps[seriesIndex]?.get(date) ?? Number.NaN),
  );
  const returns = closes.map((values) =>
    values.slice(1).map((value, index) => {
      const previous = values[index];
      return previous !== undefined && previous > 0 ? value / previous - 1 : 0;
    }),
  );
  return { dates, closes, returns };
}

function correlation(left: ReadonlyArray<number>, right: ReadonlyArray<number>): number {
  if (left.length !== right.length || left.length < 2) return 0;
  const leftMean = mean(left);
  const rightMean = mean(right);
  let numerator = 0;
  let leftVariance = 0;
  let rightVariance = 0;
  for (let index = 0; index < left.length; index += 1) {
    const leftDelta = (left[index] ?? 0) - leftMean;
    const rightDelta = (right[index] ?? 0) - rightMean;
    numerator += leftDelta * rightDelta;
    leftVariance += leftDelta ** 2;
    rightVariance += rightDelta ** 2;
  }
  const denominator = Math.sqrt(leftVariance * rightVariance);
  return denominator === 0 ? 0 : clampCorrelation(numerator / denominator);
}

export function computeCorrelationMatrix(
  series: ReadonlyArray<PortfolioSeries>,
): CorrelationMatrix {
  const aligned = alignPortfolioSeries(series);
  const values = aligned.returns.map((left, leftIndex) =>
    aligned.returns.map((right, rightIndex) =>
      leftIndex === rightIndex ? 1 : correlation(left, right),
    ),
  );
  return {
    symbols: series.map((item) => item.symbol),
    values,
    observations: aligned.returns[0]?.length ?? 0,
    startDate: aligned.dates[0] ?? "",
    endDate: aligned.dates.at(-1) ?? "",
  };
}

function makeWeights(series: ReadonlyArray<PortfolioSeries>): PortfolioWeight[] {
  const weight = 1 / series.length;
  return series.map((item) => ({
    instrumentId: item.instrumentId,
    symbol: item.symbol,
    weight,
  }));
}

/**
 * Deterministic equal-weight portfolio mark.  The portfolio is rebalanced to
 * equal weights on each common close, making it a useful neutral benchmark
 * before an optimizer or user-defined allocation is introduced.
 */
export function runPortfolioBacktest(
  series: ReadonlyArray<PortfolioSeries>,
  config: { readonly initialCapital: number; readonly feeBps: number },
): PortfolioBacktestResult {
  const aligned = alignPortfolioSeries(series);
  const weights = makeWeights(series);
  const initialCapital = Math.max(
    1,
    Number.isFinite(config.initialCapital) ? config.initialCapital : 1,
  );
  const feeBps = Number.isFinite(config.feeBps) ? config.feeBps : 0;
  const fee = Math.min(0.99, Math.max(0, feeBps) / 10_000);
  let value = initialCapital * (1 - fee);
  let peak = value;
  const equity: PortfolioEquityPoint[] = [
    { date: aligned.dates[0] ?? "", equity: value, drawdown: 0 },
  ];
  const dailyReturns: number[] = [];

  for (let dateIndex = 1; dateIndex < aligned.dates.length; dateIndex += 1) {
    const weightedReturn = aligned.returns.reduce(
      (sum, seriesReturns, seriesIndex) =>
        sum + (seriesReturns[dateIndex - 1] ?? 0) * (weights[seriesIndex]?.weight ?? 0),
      0,
    );
    const before = value;
    value *= 1 + weightedReturn;
    dailyReturns.push(before > 0 ? value / before - 1 : 0);
    peak = Math.max(peak, value);
    equity.push({
      date: aligned.dates[dateIndex] ?? "",
      equity: value,
      drawdown: peak > 0 ? value / peak - 1 : 0,
    });
  }

  const firstCloses = aligned.closes.map((values) => values[0] ?? 0);
  const lastCloses = aligned.closes.map((values) => values.at(-1) ?? 0);
  const buyHoldReturn = mean(
    firstCloses.map((first, index) => {
      const last = lastCloses[index] ?? 0;
      return first > 0 ? last / first - 1 : 0;
    }),
  );
  const totalReturn = value / initialCapital - 1;
  const years = portfolioYears(aligned.dates);
  const dailyVolatility = standardDeviation(dailyReturns);
  const metrics: PortfolioMetrics = {
    totalReturn,
    annualizedReturn: years > 0 ? (1 + totalReturn) ** (1 / years) - 1 : 0,
    volatility: dailyVolatility * Math.sqrt(TRADING_DAYS),
    sharpe:
      dailyVolatility > 0 ? (mean(dailyReturns) / dailyVolatility) * Math.sqrt(TRADING_DAYS) : 0,
    buyHoldReturn,
    maxDrawdown: Math.min(0, ...equity.map((point) => point.drawdown)),
    finalEquity: value,
    observations: dailyReturns.length,
    seriesCount: series.length,
  };
  return { equity, metrics, weights };
}

export function buildPortfolioAnalysis(
  series: ReadonlyArray<PortfolioSeries>,
  config: { readonly initialCapital: number; readonly feeBps: number },
): PortfolioAnalysis {
  if (series.length === 0) throw new Error("portfolio needs at least one series");
  return {
    version: 1,
    series,
    correlation: computeCorrelationMatrix(series),
    backtest: runPortfolioBacktest(series, config),
  };
}

export function isPortfolioAnalysis(value: unknown): value is PortfolioAnalysis {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<PortfolioAnalysis>;
  return (
    candidate.version === 1 &&
    Array.isArray(candidate.series) &&
    candidate.series.length > 0 &&
    Array.isArray(candidate.correlation?.symbols) &&
    Array.isArray(candidate.correlation?.values) &&
    Array.isArray(candidate.backtest?.equity) &&
    Array.isArray(candidate.backtest?.weights) &&
    Number.isFinite(candidate.backtest?.metrics?.finalEquity)
  );
}
