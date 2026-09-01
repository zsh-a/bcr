import type { FullQuote, IndustryBoard, SectorFundFlowItem } from "stock-sdk";
import type {
  MarketInstrument,
  MarketLandscapeSnapshot,
  MarketRankingItem,
  MarketSectorPulse,
} from "./model";

const RANKING_SIZE = 8;
const SECTOR_SIZE = 14;

export interface MarketLandscapeSource {
  readonly quotes: ReadonlyArray<FullQuote>;
  readonly boards?: ReadonlyArray<IndustryBoard>;
  readonly sectorFlows?: ReadonlyArray<SectorFundFlowItem>;
  readonly receivedAt?: number;
  readonly provider: string;
  readonly errors?: ReadonlyArray<string>;
}

function numericCode(value: string): string | null {
  const match = value.replace(/^(sh|sz|bj)/i, "").match(/\d{6}$/);
  return match?.[0] ?? null;
}

function isAShareQuote(quote: FullQuote): boolean {
  const code = numericCode(quote.code);
  if (code === null || /^(200|900)/.test(code)) return false;
  return (
    /^(?:00|30|60|68|4|8|92)/.test(code) &&
    Number.isFinite(quote.price) &&
    quote.price > 0 &&
    Number.isFinite(quote.changePercent)
  );
}

export function aShareInstrument(codeValue: string, name: string): MarketInstrument | null {
  const code = numericCode(codeValue);
  if (code === null) return null;
  const isShanghai = code.startsWith("6");
  const isBeijing = /^(?:4|8|92)/.test(code);
  const venueId = isShanghai ? "SSE" : isBeijing ? "BSE" : "SZSE";
  const venue = isShanghai ? "Shanghai" : isBeijing ? "Beijing" : "Shenzhen";
  const suffix = isShanghai ? "SH" : isBeijing ? "BJ" : "SZ";
  return {
    id: `CN:${venueId}:${code}`,
    symbol: `${code}.${suffix}`,
    sourceSymbol: code,
    name,
    shortName: name,
    market: "CN",
    venue,
    currency: "CNY",
    timezone: "Asia/Shanghai",
    assetClass: "equity",
  };
}

function rankingItem(quote: FullQuote, rank: number): MarketRankingItem | null {
  const instrument = aShareInstrument(quote.code, quote.name);
  if (instrument === null) return null;
  return {
    rank,
    instrument,
    price: quote.price,
    changePercent: quote.changePercent,
    // Tencent 的 FullQuote.amount 单位为万元，领域层统一换算为元。
    amount: Math.max(0, quote.amount) * 10_000,
    turnoverRate: quote.turnoverRate,
  };
}

function ranked(
  quotes: ReadonlyArray<FullQuote>,
  compare: (left: FullQuote, right: FullQuote) => number,
): ReadonlyArray<MarketRankingItem> {
  return [...quotes]
    .sort(compare)
    .slice(0, RANKING_SIZE)
    .flatMap((quote, index) => {
      const item = rankingItem(quote, index + 1);
      return item === null ? [] : [item];
    });
}

function sectorPulse(
  board: IndustryBoard,
  flows: ReadonlyMap<string, SectorFundFlowItem>,
): MarketSectorPulse | null {
  if (board.changePercent === null || !Number.isFinite(board.changePercent)) return null;
  const riseCount = board.riseCount ?? 0;
  const fallCount = board.fallCount ?? 0;
  // 盘前板块接口会返回一整页 0 值；此时交给韧性服务使用最近缓存或演示基线。
  if (Math.abs(board.changePercent) < 0.0001 && riseCount === 0 && fallCount === 0) return null;
  const flow = flows.get(board.code);
  const leaderCode = flow?.topStockCode;
  const leaderName = flow?.topStockName ?? board.leadingStock ?? "";
  const leader =
    leaderCode === undefined || leaderCode === "-"
      ? null
      : aShareInstrument(leaderCode, leaderName === "-" ? leaderCode : leaderName);
  return {
    code: board.code,
    name: board.name,
    changePercent: board.changePercent,
    riseCount,
    fallCount,
    turnoverRate: board.turnoverRate,
    totalMarketCap: board.totalMarketCap,
    mainNetInflow: flow?.mainNetInflow ?? null,
    mainNetInflowPercent: flow?.mainNetInflowPercent ?? null,
    leader,
    leaderChangePercent: board.leadingStockChangePercent,
  };
}

export function buildMarketLandscape(source: MarketLandscapeSource): MarketLandscapeSnapshot {
  const receivedAt = source.receivedAt ?? Date.now();
  const quotes = source.quotes.filter(isAShareQuote);
  const advancing = quotes.filter((quote) => quote.changePercent > 0).length;
  const declining = quotes.filter((quote) => quote.changePercent < 0).length;
  const limitUp = quotes.filter(
    (quote) => quote.limitUp !== null && quote.price >= quote.limitUp - 0.005,
  ).length;
  const limitDown = quotes.filter(
    (quote) => quote.limitDown !== null && quote.price <= quote.limitDown + 0.005,
  ).length;
  const rankable = quotes.filter((quote) => quote.amount > 0);
  const flowMap = new Map((source.sectorFlows ?? []).map((flow) => [flow.code, flow]));
  const sectors = (source.boards ?? [])
    .flatMap((board) => {
      const item = sectorPulse(board, flowMap);
      return item === null ? [] : [item];
    })
    .sort((left, right) => Math.abs(right.changePercent) - Math.abs(left.changePercent))
    .slice(0, SECTOR_SIZE);
  const errors = source.errors ?? [];

  return {
    breadth: {
      total: quotes.length,
      advancing,
      declining,
      unchanged: quotes.length - advancing - declining,
      limitUp,
      limitDown,
      amount: quotes.reduce((sum, quote) => sum + Math.max(0, quote.amount) * 10_000, 0),
    },
    rankings: {
      gainers: ranked(rankable, (left, right) => right.changePercent - left.changePercent),
      decliners: ranked(rankable, (left, right) => left.changePercent - right.changePercent),
      turnover: ranked(rankable, (left, right) => right.amount - left.amount),
    },
    sectors,
    receivedAt,
    quality: errors.length > 0 ? "partial" : "delayed",
    provider: source.provider,
    errors,
  };
}
