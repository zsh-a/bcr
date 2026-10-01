import { chunkData, type ResultSource, type ResultStorage } from "./result-data";
import type { LedgerRow, ResearchDay } from "./research-model";

export interface DrawdownEpisode {
  peak: string;
  trough: string;
  recovered: string | null;
  depth: number;
  sessions: number;
}
export interface ResearchSummary {
  assets: LedgerRow[];
  industries: { industry: string; profit: number; value: number; weight: number }[];
  profit: number;
  realized: number;
  unrealized: number;
  fees: number;
  income: number;
  reconciliationError: number;
  episodes: DrawdownEpisode[];
  rolling: { date: string; return: number; volatility: number; sharpe: number }[];
}
async function* researchDays(
  storage: ResultStorage,
  source: ResultSource,
  signal: AbortSignal,
  from = "",
  to = "9999",
) {
  signal.throwIfAborted();
  if (!source.diagnostics) throw new Error("该运行未记录研究账本，请重新运行回测");
  if (!source.chunks) {
    for (const day of source.research ?? []) if (day.date >= from && day.date <= to) yield day;
    return;
  }
  for (const index of source.chunks) {
    signal.throwIfAborted();
    if (index.end < from || index.start > to) continue;
    const chunk = await chunkData(storage, index.ref, signal);
    signal.throwIfAborted();
    if (!chunk.research) throw new Error("研究分片缺少账本，请重新运行回测");
    for (const day of chunk.research) if (day.date >= from && day.date <= to) yield day;
  }
}
export async function researchSummary(
  storage: ResultStorage,
  source: ResultSource,
  capital: number,
  signal: AbortSignal,
): Promise<ResearchSummary> {
  const accounts = new Map<string, LedgerRow>(),
    sectors = new Map<string, number>();
  const episodes: DrawdownEpisode[] = [],
    rolling: ResearchSummary["rolling"] = [],
    returns: number[] = [];
  let previous = capital,
    peak = capital,
    peakDate = "初始本金",
    peakIndex = 0,
    index = 0,
    lastDate = "",
    error = 0;
  let episode: DrawdownEpisode | undefined;
  for await (const day of researchDays(storage, source, signal)) {
    signal.throwIfAborted();
    if (day.date <= lastDate || !Number.isFinite(day.equity) || day.equity <= 0)
      throw new Error("研究账本日期或资产无效");
    lastDate = day.date;
    index++;
    let daily = 0,
      value = 0;
    const codes = new Set<string>();
    for (const row of day.ledger) {
      if (
        codes.has(row.code) ||
        Object.values(row).some((v) => typeof v === "number" && !Number.isFinite(v))
      )
        throw new Error("研究账本证券重复或金额无效");
      codes.add(row.code);
      accounts.set(row.code, row);
      sectors.set(row.industry, (sectors.get(row.industry) ?? 0) + row.dailyProfit);
      daily += row.dailyProfit;
      value += row.value;
    }
    error = Math.max(
      error,
      Math.abs(day.equity - day.cash - day.receivables - value),
      Math.abs(day.equity - previous - daily),
    );
    const r = day.equity / previous - 1;
    previous = day.equity;
    returns.push(r);
    if (returns.length > 63) returns.shift();
    if (returns.length === 63) {
      const mean = returns.reduce((a, b) => a + b, 0) / 63;
      const variance = returns.reduce((a, b) => a + (b - mean) ** 2, 0) / 62;
      rolling.push({
        date: day.date,
        return: returns.reduce((a, b) => a * (1 + b), 1) - 1,
        volatility: Math.sqrt(variance * 252),
        sharpe: variance > 0 ? (mean / Math.sqrt(variance)) * Math.sqrt(252) : 0,
      });
    }
    if (day.equity >= peak) {
      if (episode) {
        episode.recovered = day.date;
        episode.sessions = index - peakIndex;
        episodes.push(episode);
        episode = undefined;
      }
      peak = day.equity;
      peakDate = day.date;
      peakIndex = index;
    } else {
      const depth = day.equity / peak - 1;
      episode ??= { peak: peakDate, trough: day.date, recovered: null, depth, sessions: 0 };
      if (depth < episode.depth) {
        episode.depth = depth;
        episode.trough = day.date;
      }
      episode.sessions = index - peakIndex;
    }
  }
  if (!index || index !== source.diagnostics?.days)
    throw new Error("研究账本不完整，请重新运行回测");
  if (episode) episodes.push(episode);
  const assets = [...accounts.values()].sort(
    (a, b) => b.profit - a.profit || a.code.localeCompare(b.code),
  );
  const sum = (field: "profit" | "realized" | "unrealized" | "fees" | "income") =>
    assets.reduce((n, a) => n + a[field], 0);
  error = Math.max(error, Math.abs(sum("profit") - (previous - capital)));
  if (error > Math.max(0.01, capital * 1e-9))
    throw new Error(`账本对账不平衡：${error.toFixed(4)} 元`);
  const exposure = new Map<string, number>();
  for (const a of assets) exposure.set(a.industry, (exposure.get(a.industry) ?? 0) + a.value);
  const industries = [...new Set([...sectors.keys(), ...exposure.keys()])]
    .map((industry) => {
      const value = exposure.get(industry) ?? 0;
      return { industry, profit: sectors.get(industry) ?? 0, value, weight: value / previous };
    })
    .sort((a, b) => b.value - a.value || b.profit - a.profit);
  // Keep chart output bounded, retaining the full ledger and complete episode table.
  const stride = Math.max(1, Math.ceil(rolling.length / 1024));
  return {
    assets,
    industries,
    profit: sum("profit"),
    realized: sum("realized"),
    unrealized: sum("unrealized"),
    fees: sum("fees"),
    income: sum("income"),
    reconciliationError: error,
    episodes: episodes.sort((a, b) => a.depth - b.depth),
    rolling: rolling.filter((_, i) => i % stride === 0 || i === rolling.length - 1),
  };
}
export interface ResearchDayPage extends Omit<ResearchDay, "ledger" | "candidates"> {
  ledger: LedgerRow[];
  candidates: NonNullable<ResearchDay["candidates"]>;
  ledgerCount: number;
  candidateCount: number;
  reasons: Record<string, number>;
}
export async function researchDay(
  storage: ResultStorage,
  source: ResultSource,
  date: string,
  offset: number,
  signal: AbortSignal,
): Promise<ResearchDayPage | null> {
  for await (const day of researchDays(storage, source, signal, date, date)) {
    const reasons: Record<string, number> = {};
    for (const c of day.candidates ?? []) reasons[c.reason] = (reasons[c.reason] ?? 0) + 1;
    return {
      ...day,
      ledger: day.ledger.slice(offset, offset + 50),
      candidates: (day.candidates ?? []).slice(offset, offset + 50),
      ledgerCount: day.ledger.length,
      candidateCount: day.candidates?.length ?? 0,
      reasons,
    };
  }
  return null;
}
export async function breadthHistory(
  storage: ResultStorage,
  source: ResultSource,
  from: string,
  to: string,
  signal: AbortSignal,
) {
  const days: Pick<ResearchDay, "date" | "breadth">[] = [];
  for await (const day of researchDays(storage, source, signal, from, to)) {
    if (days.length >= 63) throw new Error("行业宽度每页最多 63 个交易日");
    days.push({ date: day.date, breadth: day.breadth });
  }
  return days;
}
