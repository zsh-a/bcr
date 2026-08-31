import type {
  BacktestMetrics,
  BacktestResult,
  EquityPoint,
  MarketBar,
  SignalPoint,
  StrategyConfig,
  Trade,
} from "./model";

const DAY_MS = 86_400_000;

function finite(value: string | undefined, label: string, row: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`第 ${row} 行 ${label} 不是有效数字`);
  return parsed;
}

/** 统一校验并按日期排序，CSV、Arrow 与 Parquet 三条入口共享同一数据契约。 */
export function validateMarketBars(input: ReadonlyArray<MarketBar>): MarketBar[] {
  if (input.length < 30) throw new Error("至少需要 30 根 K 线");
  const dates = new Set<string>();
  const bars = input.map((bar, index): MarketBar => {
    const row = index + 1;
    const timestamp = Date.parse(bar.date);
    if (bar.date.length === 0 || Number.isNaN(timestamp)) {
      throw new Error(`第 ${row} 行 date 无效`);
    }
    const date = new Date(timestamp).toISOString().slice(0, 10);
    if (dates.has(date)) throw new Error(`第 ${row} 行 date 重复`);
    dates.add(date);
    for (const [label, value] of Object.entries(bar)) {
      if (label !== "date" && !Number.isFinite(value)) {
        throw new Error(`第 ${row} 行 ${label} 不是有效数字`);
      }
    }
    if (
      bar.open <= 0 ||
      bar.high <= 0 ||
      bar.low <= 0 ||
      bar.close <= 0 ||
      bar.volume < 0 ||
      bar.low > Math.min(bar.open, bar.close) ||
      bar.high < Math.max(bar.open, bar.close) ||
      bar.low > bar.high
    ) {
      throw new Error(`第 ${row} 行 OHLCV 关系无效`);
    }
    return { ...bar, date };
  });
  return bars.sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
}

/** 支持 date/open/high/low/close/volume 标准 OHLCV CSV；列名大小写不敏感。 */
export function parseMarketCsv(text: string): MarketBar[] {
  const lines = text
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const header = lines[0]?.split(",").map((cell) => cell.trim().toLowerCase());
  if (header === undefined) throw new Error("CSV 为空");

  const column = (name: string): number => {
    const index = header.indexOf(name);
    if (index < 0) throw new Error(`CSV 缺少 ${name} 列`);
    return index;
  };
  const columns = {
    date: column("date"),
    open: column("open"),
    high: column("high"),
    low: column("low"),
    close: column("close"),
    volume: column("volume"),
  };

  const bars = lines.slice(1).map((line, index): MarketBar => {
    const row = line.split(",").map((cell) => cell.trim());
    const rowNumber = index + 2;
    const date = row[columns.date];
    if (date === undefined || date.length === 0 || Number.isNaN(Date.parse(date))) {
      throw new Error(`第 ${rowNumber} 行 date 无效`);
    }
    const bar = {
      date,
      open: finite(row[columns.open], "open", rowNumber),
      high: finite(row[columns.high], "high", rowNumber),
      low: finite(row[columns.low], "low", rowNumber),
      close: finite(row[columns.close], "close", rowNumber),
      volume: finite(row[columns.volume], "volume", rowNumber),
    };
    if (bar.low > Math.min(bar.open, bar.close) || bar.high < Math.max(bar.open, bar.close)) {
      throw new Error(`第 ${rowNumber} 行 OHLC 关系无效`);
    }
    return bar;
  });

  return validateMarketBars(bars);
}

/** 固定种子的多周期行情，确保首次打开即可复现并命中缓存。 */
export function generateDemoMarket(count = 720): MarketBar[] {
  let seed = 0x5f3759df;
  const random = (): number => {
    seed = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0;
    return seed / 0x1_0000_0000;
  };
  const bars: MarketBar[] = [];
  let close = 100;
  let timestamp = Date.UTC(2023, 0, 2);

  while (bars.length < count) {
    const day = new Date(timestamp).getUTCDay();
    timestamp += DAY_MS;
    if (day === 0 || day === 6) continue;
    const i = bars.length;
    const regime = i < count * 0.28 ? 0.0009 : i < count * 0.52 ? -0.00045 : 0.00065;
    const cycle = Math.sin(i / 18) * 0.0024 + Math.sin(i / 67) * 0.0017;
    const shock = (random() - 0.5) * 0.025;
    const open = close * (1 + (random() - 0.5) * 0.006);
    close = Math.max(8, open * (1 + regime + cycle + shock));
    const spread = 0.003 + random() * 0.014;
    bars.push({
      date: new Date(timestamp - DAY_MS).toISOString().slice(0, 10),
      open,
      high: Math.max(open, close) * (1 + spread),
      low: Math.min(open, close) * (1 - spread * (0.65 + random() * 0.5)),
      close,
      volume: Math.round(600_000 + random() * 1_900_000 + Math.abs(shock) * 35_000_000),
    });
  }
  return validateMarketBars(bars);
}

export function computeSmaSignals(
  bars: ReadonlyArray<MarketBar>,
  fastPeriod: number,
  slowPeriod: number,
): SignalPoint[] {
  const fast = Math.floor(fastPeriod);
  const slow = Math.floor(slowPeriod);
  if (fast < 2 || slow <= fast) throw new Error("均线周期必须满足 2 ≤ fast < slow");
  if (bars.length < slow) throw new Error(`行情长度不足 slow period (${slow})`);

  let fastSum = 0;
  let slowSum = 0;
  let previous: 0 | 1 = 0;
  return bars.map((bar, index): SignalPoint => {
    fastSum += bar.close;
    slowSum += bar.close;
    if (index >= fast) fastSum -= bars[index - fast]?.close ?? 0;
    if (index >= slow) slowSum -= bars[index - slow]?.close ?? 0;
    const fastValue = index >= fast - 1 ? fastSum / fast : null;
    const slowValue = index >= slow - 1 ? slowSum / slow : null;
    const position: 0 | 1 =
      fastValue !== null && slowValue !== null && fastValue > slowValue ? 1 : 0;
    const action = position === previous ? null : position === 1 ? "buy" : "sell";
    previous = position;
    return { date: bar.date, fast: fastValue, slow: slowValue, position, action };
  });
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

export function runBacktest(
  bars: ReadonlyArray<MarketBar>,
  signals: ReadonlyArray<SignalPoint>,
  config: Pick<StrategyConfig, "initialCapital" | "feeBps">,
): BacktestResult {
  if (bars.length !== signals.length || bars.length === 0) {
    throw new Error("行情与信号长度必须一致且非空");
  }
  const initialCapital = Math.max(1, config.initialCapital);
  const fee = Math.min(0.99, Math.max(0, config.feeBps) / 10_000);
  const equity: EquityPoint[] = [];
  const trades: Trade[] = [];
  const dailyReturns: number[] = [];
  let value = initialCapital;
  let peak = initialCapital;
  let position: 0 | 1 = 0;
  let entry: { date: string; price: number; capital: number } | null = null;
  let exposedBars = 0;

  for (let index = 0; index < bars.length; index += 1) {
    const bar = bars[index];
    const signal = signals[index];
    if (bar === undefined || signal === undefined) continue;
    const previousClose = bars[index - 1]?.close;
    const before = value;
    if (position === 1 && previousClose !== undefined && previousClose > 0) {
      value *= 1 + (bar.close / previousClose - 1);
      exposedBars += 1;
    }

    if (signal.position !== position) {
      value *= 1 - fee;
      if (signal.position === 1) {
        entry = { date: bar.date, price: bar.close, capital: value };
      } else if (entry !== null) {
        trades.push({
          entryDate: entry.date,
          entryPrice: entry.price,
          exitDate: bar.date,
          exitPrice: bar.close,
          returnPct: bar.close / entry.price - 1 - fee * 2,
          pnl: value - entry.capital,
        });
        entry = null;
      }
      position = signal.position;
    }

    const dailyReturn = before > 0 ? value / before - 1 : 0;
    if (index > 0) dailyReturns.push(dailyReturn);
    peak = Math.max(peak, value);
    equity.push({ date: bar.date, equity: value, drawdown: peak > 0 ? value / peak - 1 : 0 });
  }

  const lastBar = bars.at(-1);
  if (entry !== null && lastBar !== undefined) {
    value *= 1 - fee;
    trades.push({
      entryDate: entry.date,
      entryPrice: entry.price,
      exitDate: lastBar.date,
      exitPrice: lastBar.close,
      returnPct: lastBar.close / entry.price - 1 - fee * 2,
      pnl: value - entry.capital,
    });
    const lastPoint = equity.at(-1);
    if (lastPoint !== undefined) {
      peak = Math.max(peak, value);
      equity[equity.length - 1] = {
        ...lastPoint,
        equity: value,
        drawdown: value / peak - 1,
      };
    }
  }

  const first = bars[0];
  const last = bars.at(-1);
  const years =
    first === undefined || last === undefined
      ? 0
      : Math.max(1 / 252, (Date.parse(last.date) - Date.parse(first.date)) / (365.25 * DAY_MS));
  const totalReturn = value / initialCapital - 1;
  const volatility = standardDeviation(dailyReturns);
  const winning = trades.filter((trade) => trade.pnl > 0).length;
  const metrics: BacktestMetrics = {
    totalReturn,
    annualizedReturn: years > 0 ? (1 + totalReturn) ** (1 / years) - 1 : 0,
    buyHoldReturn:
      first !== undefined && last !== undefined && first.close > 0
        ? last.close / first.close - 1
        : 0,
    sharpe: volatility > 0 ? (mean(dailyReturns) / volatility) * Math.sqrt(252) : 0,
    maxDrawdown: Math.min(0, ...equity.map((point) => point.drawdown)),
    winRate: trades.length > 0 ? winning / trades.length : 0,
    exposure: bars.length > 1 ? exposedBars / (bars.length - 1) : 0,
    tradeCount: trades.length,
    finalEquity: value,
  };
  return { equity, trades, metrics };
}
