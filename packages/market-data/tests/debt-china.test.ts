import { describe, expect, it, vi } from "vitest";
import {
  decodeChinaSource,
  discoverChinaTables,
  discoverChinaYearPages,
  parseChinaFlowTable,
  parseChinaStockGrowth,
} from "../src/debt/china";
import { bundledChinaDebtSnapshot, decodeChinaDebtSnapshot } from "../src/debt/china-snapshot";

const now = new Date("2026-10-25T08:00:00Z");
const headings = [
  "AFRE(flow)",
  "RMB loans",
  "Foreign currency-denominated loans",
  "Entrusted loans",
  "Trust loans",
  "Undiscounted bankers' acceptances",
  "Net financing of corporate bonds",
  "Government bonds",
  "Equity financing",
  "Asset-backed securities",
  "Loans written off",
];
const tr = (values: (string | number)[]) =>
  `<tr>${values.map((value) => `<td>${value}</td>`).join("")}</tr>`;
const flowRow = ["2025.01", 70546, 52194, -392, 449, 623, 4654, 4454, 6933, 473, -227, 397];
const flow = (data: (string | number)[][]) =>
  `<table><caption>社会融资规模增量统计表 Unit: 100 million Yuan</caption>${tr(headings)}${data.map(tr).join("")}</table>`;
const stock = () =>
  `<table><caption>AFRE(stock) Unit: Trillion Yuan Growth Rate(%)</caption>${tr(["", ...Array.from({ length: 12 }, (_, index) => `2025.${index + 1}`)])}${tr(["社会融资规模存量 AFRE(stock)", 415.2, 8, 418.27, 8.2, ...Array(20).fill("")])}</table>`;

describe("China PBOC credit supplement", () => {
  it("keeps monthly flows, signed net financing and the exact CNY scaling", () => {
    const parsed = parseChinaFlowTable(
      flow([
        flowRow,
        ["2025.02", 22331, 6528, -281, -228, -330, -2987, 1702, 16939, 76, -269, 542],
      ]),
      2025,
      now,
    );
    expect(parsed.socialFinancingFlow).toEqual([
      { period: "2025-01", value: 7.0546 },
      { period: "2025-02", value: 2.2331 },
    ]);
    expect(parsed.rmbLoanFlow[0]?.value).toBe(5.2194);
    expect(parsed.corporateBondFlow[0]?.value).toBe(0.4454);
    expect(parsed.governmentBondFlow[0]?.value).toBe(0.6933);
    const negative = [...flowRow];
    negative[7] = -905;
    expect(parseChinaFlowTable(flow([negative]), 2025, now).corporateBondFlow[0]?.value).toBe(
      -0.0905,
    );
  });

  it("does not invent calendar placeholders or turn reported zero into missing", () => {
    const zero = ["2025.01", ...Array(11).fill(0)];
    const empty = ["2025.02", ...Array(11).fill("&nbsp;")];
    expect(parseChinaFlowTable(flow([zero, empty]), 2025, now).socialFinancingFlow).toEqual([
      { period: "2025-01", value: 0 },
    ]);
    expect(() => parseChinaFlowTable(flow([["2027.01", ...flowRow.slice(1)]]), 2027, now)).toThrow(
      /未来/u,
    );
  });

  it("validates units, headings, year and duplicate months at the source boundary", () => {
    expect(() =>
      parseChinaFlowTable(flow([flowRow]).replace("100 million", "trillion"), 2025, now),
    ).toThrow();
    expect(() =>
      parseChinaFlowTable(flow([flowRow]).replace("RMB loans", "Different loans"), 2025, now),
    ).toThrow();
    expect(() => parseChinaFlowTable(flow([flowRow, flowRow]), 2025, now)).toThrow(/重复/u);
    expect(() => parseChinaFlowTable(flow([flowRow]), 2024, now)).toThrow(/年度/u);
    const invalid = [...flowRow];
    invalid[1] = "Not a number";
    expect(() => parseChinaFlowTable(flow([invalid]), 2025, now)).toThrow(/数值/u);
  });

  it("reads published stock YoY instead of calculating growth from adjacent stock levels", () => {
    expect(parseChinaStockGrowth(stock(), 2025, now)).toEqual([
      { period: "2025-01", value: 8 },
      { period: "2025-02", value: 8.2 },
    ]);
    expect(() =>
      parseChinaStockGrowth(stock().replace("Growth Rate(%)", "Growth"), 2025, now),
    ).toThrow();
  });

  it("decodes GB2312 exports and constrains discovery to official HTTPS source tables", () => {
    const header = new TextEncoder().encode('<meta charset="gb2312">');
    const bytes = new Uint8Array([...header, 0xd2, 0xda, 0xd4, 0xaa]);
    expect(decodeChinaSource(bytes)).toContain("亿元");
    const index =
      '<a href="http://">bad</a><a href="/2025/index.html">2025年统计数据</a><a href="/2025/afre/index.html">社会融资规模</a><a href="/2026/index.html">2026年统计数据</a><a href="/2026/afre/index.html">社会融资规模</a><a href="/2027/index.html">2027年统计数据</a><a href="/2027/afre/index.html">社会融资规模</a>';
    expect(discoverChinaYearPages(index, now).map((item) => item.year)).toEqual([2025, 2026]);
    const tables =
      '<a href="/data/flow.htm">htm</a><a href="/data/flow.xls">xls</a><a href="https://unrelated.example/stock.htm">htm</a><a href="/data/stock.htm">htm</a>';
    expect(discoverChinaTables(tables, "https://www.pbc.gov.cn/")).toEqual({
      flow: "https://www.pbc.gov.cn/data/flow.htm",
      stock: "https://www.pbc.gov.cn/data/stock.htm",
    });
  });

  it("loads real published observations offline and retains the AFRE scope caveat", () => {
    const network = vi.spyOn(globalThis, "fetch");
    expect(bundledChinaDebtSnapshot.series).toHaveLength(5);
    expect(
      bundledChinaDebtSnapshot.series.every(
        (series) =>
          series.country === "CHN" && series.frequency === "M" && series.observations.length >= 12,
      ),
    ).toBe(true);
    const afre = bundledChinaDebtSnapshot.series.find(
      (series) => series.indicator === "socialFinancingFlow",
    )!;
    expect(afre.note).toContain("不能视为纯债务");
    expect(afre.note).toContain("非年内累计");
    expect(afre.unit).toBe("trillionLocal");
    expect(afre.currency).toBe("CNY");
    expect(
      bundledChinaDebtSnapshot.series.find((series) => series.indicator === "socialFinancingGrowth")
        ?.currency,
    ).toBeNull();
    expect(network).not.toHaveBeenCalled();
    network.mockRestore();
    expect(() =>
      decodeChinaDebtSnapshot({
        ...bundledChinaDebtSnapshot,
        series: [...bundledChinaDebtSnapshot.series, afre],
      }),
    ).toThrow();
  });
});
