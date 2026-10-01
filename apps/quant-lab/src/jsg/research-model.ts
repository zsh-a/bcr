export interface Diagnostics {
  version: number;
  days: number;
  rows: number;
  instrumentDays: number;
  nonPositiveProfit: number;
  zeroShares: number;
  unknownIndustry: number;
  suspended: number;
  st: number;
  staleHeldMarks: number;
  firstDate: string | null;
  lastDate: string | null;
}
export interface LedgerRow {
  code: string;
  industry: string;
  quantity: number;
  averageCost: number;
  price: number;
  markDate: string;
  value: number;
  weight: number;
  cashflow: number;
  receivable: number;
  income: number;
  fees: number;
  dailyProfit: number;
  profit: number;
  realized: number;
  unrealized: number;
}
export interface Candidate {
  code: string;
  industry: string;
  marketCap: number;
  rank: number | null;
  reason: string;
  tradable: boolean;
}
export interface ResearchDay {
  date: string;
  cash: number;
  receivables: number;
  equity: number;
  breadth: { industry: string; above: number; total: number; ratio: number }[];
  ledger: LedgerRow[];
  candidates: Candidate[] | null;
}
export const CANDIDATE_REASONS: Record<string, string> = {
  target: "目标证券",
  pool: "候选池 · 超出目标数量",
  "outside-pool": "市值排名超出候选池",
  st: "ST 股票",
  "non-positive-profit": "无正利润观测",
  "zero-shares": "股本不可用",
  "industry-blacklist": "最宽行业在排除名单",
  "insufficient-history": "MA20 历史不足",
  "portfolio-stop": "组合回撤风控阻止调仓",
};
