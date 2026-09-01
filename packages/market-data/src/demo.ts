import { PULSE_INSTRUMENTS } from "./instruments";
import { aShareInstrument } from "./landscape";
import type {
  MarketAtlasSnapshot,
  MarketInstrument,
  MarketLandscapeSnapshot,
  MarketRankingItem,
  MarketSectorPulse,
  MarketSession,
  QuoteSnapshot,
} from "./model";
import { quoteSparkline } from "./sparkline";

const DEMO_QUOTES = [
  [3_472.15, 0.62],
  [4_183.81, 0.21],
  [2_891.44, -0.74],
  [1_299.52, 0.16],
  [41.34, 0.83],
  [25_077.48, 1.18],
  [5_644.2, 1.84],
  [612.5, 0.49],
  [154.7, 1.31],
  [54.9, -0.72],
  [45_544.88, -0.19],
  [6_487.32, 0.34],
  [21_455.55, 0.76],
  [313.49, -1.94],
  [178.42, 1.12],
] as const;

function quote(
  instrument: MarketInstrument,
  price: number,
  changePercent: number,
  receivedAt: number,
): QuoteSnapshot {
  const previousClose = price / (1 + changePercent / 100);
  return {
    instrument,
    price,
    change: price - previousClose,
    changePercent,
    previousClose,
    high: price * 1.006,
    low: price * 0.991,
    volume: null,
    amount: null,
    sourceTimestamp: null,
    receivedAt,
    quality: "demo",
    source: "BCR deterministic fixture",
    sparkline: quoteSparkline(instrument.id, price, changePercent),
  };
}

function timeIn(timezone: string, now: number): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(now);
}

export function fallbackSessions(now = Date.now()): ReadonlyArray<MarketSession> {
  return [
    {
      market: "CN",
      city: "SHANGHAI",
      venue: "SSE / SZSE",
      timezone: "Asia/Shanghai",
      localTime: timeIn("Asia/Shanghai", now),
      state: "closed",
      coverage: "live",
    },
    {
      market: "HK",
      city: "HONG KONG",
      venue: "HKEX",
      timezone: "Asia/Hong_Kong",
      localTime: timeIn("Asia/Hong_Kong", now),
      state: "closed",
      coverage: "live",
    },
    {
      market: "EU",
      city: "LONDON",
      venue: "LSE · NEXT PROVIDER",
      timezone: "Europe/London",
      localTime: timeIn("Europe/London", now),
      state: "planned",
      coverage: "planned",
    },
    {
      market: "US",
      city: "NEW YORK",
      venue: "NYSE / NASDAQ",
      timezone: "America/New_York",
      localTime: timeIn("America/New_York", now),
      state: "closed",
      coverage: "live",
    },
  ];
}

export function createDemoSnapshot(errors: ReadonlyArray<string> = []): MarketAtlasSnapshot {
  const receivedAt = Date.now();
  const quotes = PULSE_INSTRUMENTS.flatMap((instrument, index) => {
    const values = DEMO_QUOTES[index];
    return values === undefined ? [] : [quote(instrument, values[0], values[1], receivedAt)];
  });
  const futures = [
    ["WTI", "WTI Crude", 76.42, 1.08],
    ["GC00Y", "COMEX Gold", 3_422.6, -0.36],
    ["CONC", "Brent Crude", 80.18, 0.74],
    ["HG00Y", "COMEX Copper", 5.71, 1.46],
    ["S00Y", "CBOT Soybean", 1_028.5, -0.58],
    ["NID", "LME Nickel", 15_322, 0.29],
  ].map(([symbol, name, price, changePercent]): QuoteSnapshot => {
    const instrument: MarketInstrument = {
      id: `GLOBAL:FUTURE:${String(symbol)}`,
      symbol: String(symbol),
      sourceSymbol: String(symbol),
      name: String(name),
      shortName: String(name).toUpperCase(),
      market: "GLOBAL",
      venue: "GLOBAL FUTURES",
      currency: "—",
      timezone: "UTC",
      assetClass: "future",
    };
    return quote(instrument, Number(price), Number(changePercent), receivedAt);
  });
  return {
    quotes,
    futures,
    sessions: fallbackSessions(receivedAt),
    feeds: ["CN", "HK", "US", "GLOBAL"].map((market) => ({
      market: market as "CN" | "HK" | "US" | "GLOBAL",
      state: "offline" as const,
      itemCount: 0,
      message: market === "GLOBAL" ? "FUTURES FIXTURE PENDING" : "USING LOCAL FIXTURE",
    })),
    receivedAt,
    quality: "demo",
    provider: "BCR fixture",
    errors,
  };
}

const DEMO_EQUITIES = [
  ["300750", "宁德时代", 312.48, 8.37, 13_820_000_000, 2.84],
  ["688981", "中芯国际", 94.16, 7.12, 9_460_000_000, 4.11],
  ["002594", "比亚迪", 118.62, 5.48, 11_280_000_000, 3.26],
  ["600519", "贵州茅台", 1_508.2, 3.16, 7_920_000_000, 0.44],
  ["601318", "中国平安", 58.74, 2.83, 6_880_000_000, 0.76],
  ["000858", "五粮液", 132.06, 2.42, 5_640_000_000, 1.12],
  ["600036", "招商银行", 46.31, 2.06, 8_260_000_000, 0.69],
  ["000333", "美的集团", 73.18, 1.82, 4_910_000_000, 0.95],
  ["601012", "隆基绿能", 17.42, -6.81, 6_120_000_000, 3.92],
  ["300059", "东方财富", 21.08, -5.67, 10_760_000_000, 5.16],
  ["002475", "立讯精密", 39.27, -4.92, 7_480_000_000, 2.71],
  ["600276", "恒瑞医药", 51.64, -4.35, 5_870_000_000, 1.83],
  ["601899", "紫金矿业", 24.15, -3.88, 9_980_000_000, 1.46],
  ["000651", "格力电器", 40.82, -3.26, 4_520_000_000, 1.97],
  ["600900", "长江电力", 29.61, -2.74, 3_760_000_000, 0.54],
  ["600030", "中信证券", 27.43, -2.18, 8_740_000_000, 1.88],
] as const;

function demoRankingItem(values: (typeof DEMO_EQUITIES)[number], rank: number): MarketRankingItem {
  const [code, name, latest, changePercent, amount, turnoverRate] = values;
  const instrument = aShareInstrument(code, name);
  if (instrument === null) throw new Error(`Invalid demo A-share code: ${code}`);
  return { rank, instrument, price: latest, changePercent, amount, turnoverRate };
}

function demoSector(
  code: string,
  name: string,
  changePercent: number,
  riseCount: number,
  fallCount: number,
  mainNetInflow: number,
  leaderValues: (typeof DEMO_EQUITIES)[number],
): MarketSectorPulse {
  const leader = aShareInstrument(leaderValues[0], leaderValues[1]);
  return {
    code,
    name,
    changePercent,
    riseCount,
    fallCount,
    turnoverRate: 1.1 + Math.abs(changePercent) * 0.34,
    totalMarketCap: (riseCount + fallCount) * 8_400_000_000,
    mainNetInflow,
    mainNetInflowPercent: mainNetInflow / 1_400_000_000,
    leader,
    leaderChangePercent: leaderValues[3],
  };
}

export function createDemoMarketLandscape(
  errors: ReadonlyArray<string> = [],
  receivedAt = Date.now(),
): MarketLandscapeSnapshot {
  const gainers = DEMO_EQUITIES.slice(0, 8).map((item, index) => demoRankingItem(item, index + 1));
  const decliners = DEMO_EQUITIES.slice(8).map((item, index) => demoRankingItem(item, index + 1));
  const turnover = [...DEMO_EQUITIES]
    .sort((left, right) => right[4] - left[4])
    .slice(0, 8)
    .map((item, index) => demoRankingItem(item, index + 1));
  const sectors = [
    demoSector("BK0911", "动力电池", 4.82, 42, 9, 2_860_000_000, DEMO_EQUITIES[0]),
    demoSector("BK1036", "半导体", 3.76, 118, 34, 4_120_000_000, DEMO_EQUITIES[1]),
    demoSector("BK1029", "汽车整车", 2.94, 19, 7, 1_780_000_000, DEMO_EQUITIES[2]),
    demoSector("BK0475", "银行", 2.08, 36, 5, 2_240_000_000, DEMO_EQUITIES[6]),
    demoSector("BK0727", "白酒", 1.64, 15, 7, 980_000_000, DEMO_EQUITIES[3]),
    demoSector("BK0456", "家电", 1.22, 47, 31, 620_000_000, DEMO_EQUITIES[7]),
    demoSector("BK0473", "证券", -1.76, 8, 42, -1_340_000_000, DEMO_EQUITIES[15]),
    demoSector("BK0731", "贵金属", -2.12, 5, 18, -860_000_000, DEMO_EQUITIES[12]),
    demoSector("BK1031", "消费电子", -2.48, 39, 102, -1_920_000_000, DEMO_EQUITIES[10]),
    demoSector("BK0478", "电力", -1.18, 26, 54, -540_000_000, DEMO_EQUITIES[14]),
    demoSector("BK0908", "光伏设备", -3.91, 12, 76, -2_680_000_000, DEMO_EQUITIES[8]),
    demoSector("BK0465", "医药商业", -2.86, 21, 69, -1_060_000_000, DEMO_EQUITIES[11]),
    demoSector("BK0447", "互联网服务", -3.34, 24, 81, -2_210_000_000, DEMO_EQUITIES[9]),
    demoSector("BK0534", "电网设备", 1.47, 63, 28, 740_000_000, DEMO_EQUITIES[4]),
  ];
  return {
    breadth: {
      total: 5_352,
      advancing: 3_116,
      declining: 1_984,
      unchanged: 252,
      limitUp: 71,
      limitDown: 9,
      amount: 1_268_400_000_000,
    },
    rankings: { gainers, decliners, turnover },
    sectors,
    receivedAt,
    quality: "demo",
    provider: "BCR market landscape fixture",
    errors,
  };
}
