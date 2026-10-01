import { describe, expect, it } from "vitest";
import { Effect } from "effect";
import { researchSummary, researchDay, breadthHistory } from "../src/jsg/research-analysis";
import type { ResultSource, ResultStorage } from "../src/jsg/result-data";
import type { Diagnostics, LedgerRow, ResearchDay } from "../src/jsg/research-model";
import { csvCell, escapeHtml, ledgerCsv } from "../src/jsg/report";

const signal = () => new AbortController().signal;
const diagnostics: Diagnostics = {
  version: 1,
  days: 4,
  rows: 4,
  instrumentDays: 4,
  nonPositiveProfit: 0,
  zeroShares: 0,
  unknownIndustry: 0,
  suspended: 0,
  st: 0,
  staleHeldMarks: 0,
  firstDate: "2024-01-01",
  lastDate: "2024-01-04",
};
function row(patch: Partial<LedgerRow>): LedgerRow {
  return {
    code: "A",
    industry: "tech",
    quantity: 10,
    averageCost: 10.1,
    price: 10,
    markDate: "2024-01-01",
    value: 100,
    weight: 100 / 999,
    cashflow: -101,
    receivable: 0,
    income: 0,
    fees: 1,
    dailyProfit: -1,
    profit: -1,
    realized: 0,
    unrealized: -1,
    ...patch,
  };
}
function source(): ResultSource {
  const days: ResearchDay[] = [
    {
      date: "2024-01-01",
      cash: 899,
      receivables: 0,
      equity: 999,
      breadth: [],
      candidates: null,
      ledger: [row({})],
    },
    {
      date: "2024-01-02",
      cash: 899,
      receivables: 0,
      equity: 1019,
      breadth: [{ industry: "tech", above: 1, total: 2, ratio: 50 }],
      candidates: null,
      ledger: [
        row({
          industry: "industrial",
          value: 120,
          price: 12,
          profit: 19,
          unrealized: 19,
          dailyProfit: 20,
        }),
      ],
    },
    {
      date: "2024-01-03",
      cash: 1007,
      receivables: 0,
      equity: 1007,
      breadth: [],
      candidates: null,
      ledger: [
        row({
          industry: "industrial",
          quantity: 0,
          value: 0,
          cashflow: 7,
          profit: 7,
          unrealized: 0,
          realized: 7,
          dailyProfit: -12,
          fees: 3,
        }),
      ],
    },
    {
      date: "2024-01-04",
      cash: 1007,
      receivables: 0,
      equity: 1007,
      breadth: [],
      candidates: null,
      ledger: [],
    },
  ];
  return { diagnostics, research: days, equity: [], orders: [], decisions: [] };
}
const unused: ResultStorage = {
  artifacts: { get: () => Effect.die("inline results must not read files") },
};
describe("fill-based research ledger", () => {
  it("reconciles buy fees, unrealized gains, a full liquidation and an inactive closing day", async () => {
    const summary = await researchSummary(unused, source(), 1000, signal());
    expect(summary.profit).toBe(7);
    expect(summary.realized).toBe(7);
    expect(summary.unrealized).toBe(0);
    expect(summary.fees).toBe(3);
    expect(summary.reconciliationError).toBe(0);
    expect(summary.industries).toEqual([
      { industry: "industrial", profit: 8, value: 0, weight: 0 },
      { industry: "tech", profit: -1, value: 0, weight: 0 },
    ]);
    expect(summary.episodes).toEqual([
      {
        peak: "2024-01-02",
        trough: "2024-01-03",
        recovered: null,
        depth: 1007 / 1019 - 1,
        sessions: 2,
      },
      {
        peak: "初始本金",
        trough: "2024-01-01",
        recovered: "2024-01-02",
        depth: -0.0010000000000000009,
        sessions: 2,
      },
    ]);
    const csv = ledgerCsv(summary, {
      instruments: { A: "示例证券" },
      industries: { industrial: "制造" },
    });
    expect(csv).toContain('"A","示例证券","industrial","制造","0","0","7"');
  });
  it("scans complete chunks even when the result preview is empty", async () => {
    const full = source(),
      reads: string[] = [];
    const chunked: ResultSource = {
      ...full,
      research: [],
      chunks: [
        {
          ref: { id: "a", type: "quant/jsg-chunk", format: "json", storage: "opfs" },
          start: "2024-01-01",
          end: "2024-01-02",
          orders: 0,
        },
        {
          ref: { id: "b", type: "quant/jsg-chunk", format: "json", storage: "opfs" },
          start: "2024-01-03",
          end: "2024-01-04",
          orders: 0,
        },
      ],
    };
    const storage: ResultStorage = {
      ...unused,
      readChunk: async (ref) => {
        reads.push(ref.id);
        return {
          equity: [],
          orders: [],
          decisions: [],
          research: full.research!.slice(ref.id === "a" ? 0 : 2, ref.id === "a" ? 2 : 4),
        };
      },
    };
    expect((await researchSummary(storage, chunked, 1000, signal())).profit).toBe(7);
    expect(reads).toEqual(["a", "b"]);
    reads.length = 0;
    expect(
      (await researchDay(storage, chunked, "2024-01-03", 0, signal()))!.ledger[0]!.quantity,
    ).toBe(0);
    expect(reads).toEqual(["b"]);
  });
  it("fails rather than showing totals from an incomplete or corrupt ledger", async () => {
    const incomplete = source();
    incomplete.research!.pop();
    await expect(researchSummary(unused, incomplete, 1000, signal())).rejects.toThrow(/不完整/u);
    const unbalanced = source();
    unbalanced.research![1]!.ledger[0]!.dailyProfit = 22;
    await expect(researchSummary(unused, unbalanced, 1000, signal())).rejects.toThrow(/不平衡/u);
    const bad = source();
    bad.research![0]!.ledger[0]!.value = NaN;
    await expect(researchSummary(unused, bad, 1000, signal())).rejects.toThrow(/无效/u);
    const abort = new AbortController();
    abort.abort();
    await expect(researchSummary(unused, source(), 1000, abort.signal)).rejects.toThrow();
  });
  it("keeps breadth units in percentage points and paginates candidates before posting to the UI", async () => {
    const full = source();
    full.research![1]!.candidates = Array.from({ length: 123 }, (_, i) => ({
      code: String(i),
      industry: "tech",
      marketCap: i,
      rank: i + 1,
      reason: i < 10 ? "target" : "outside-pool",
      tradable: true,
    }));
    const day = await researchDay(unused, full, "2024-01-02", 50, signal());
    expect(day!.candidates).toHaveLength(50);
    expect(day!.candidates[0]!.code).toBe("50");
    expect(day!.candidateCount).toBe(123);
    expect(day!.reasons).toEqual({ target: 10, "outside-pool": 113 });
    const history = await breadthHistory(unused, full, "2024-01-02", "2024-01-02", signal());
    expect(history[0]!.breadth[0]!.ratio).toBe(50);
  });
  it("escapes reports and prevents string CSV formulas without changing numeric losses", () => {
    expect(escapeHtml('<img src="x">&')).toBe("&lt;img src=&quot;x&quot;&gt;&amp;");
    expect(csvCell("=1+1")).toBe('"\'=1+1"');
    expect(csvCell(-12)).toBe('"-12"');
  });
});
