import { describe, expect, it } from "vitest";
import { bundledDebtSnapshot, getDebtSeries, type DebtSnapshot } from "@bcr/market-data/debt";
import {
  debtReadingIsOld,
  debtStateUrl,
  debtTrendEnd,
  debtWindowQuarters,
  parseDebtState,
} from "../src/debt/state";
import { debtCsv } from "../src/debt/export";
import { manifest } from "../src/app-manifest";

describe("debt research navigation and native-frequency exports", () => {
  it("preserves quarter links in the embedded host without quoting numeric query strings", () => {
    const query = {
      view: "macro",
      layer: "debt",
      countries: "USA,CHN",
      debtQuarter: "2025-Q3",
      debtWindow: "all",
      debtFocus: "USA",
      debtMetric: "creditGap",
      debtMode: "phase",
      debtAsOf: "quarter",
    };
    const validated = manifest.validateSearch(query),
      search = new URLSearchParams(
        Object.entries(validated).filter(
          (entry): entry is [string, string] => typeof entry[1] === "string",
        ),
      ).toString();
    const state = parseDebtState(search, bundledDebtSnapshot);
    expect(state).toEqual({
      countries: ["USA", "CHN"],
      quarter: "2025-Q3",
      window: "all",
      focus: "USA",
      metric: "creditGap",
      mode: "phase",
      asOf: "quarter",
    });
    expect(
      parseDebtState(
        new URL(debtStateUrl(state), "https://example.test").search,
        bundledDebtSnapshot,
      ),
    ).toEqual(state);
    expect(
      manifest.validateSearch({ debtQuarter: "2026-Q5", layer: "bad", debtAsOf: "bad" }),
    ).toMatchObject({ debtQuarter: undefined, layer: undefined, debtAsOf: undefined });
  });
  it("does not silently replace unsupported economies and clamps quarter windows", () => {
    expect(parseDebtState("?countries=IND", bundledDebtSnapshot).countries).toEqual([]);
    const state = parseDebtState(
      "?countries=USA,USA,IND&debtQuarter=1900-Q1&debtMetric=unknown&debtFocus=JPN",
      bundledDebtSnapshot,
    );
    expect(state.countries).toEqual(["USA"]);
    expect(state.focus).toBe("USA");
    expect(state.metric).toBe("privateDebt");
    expect(state.quarter).toBe(debtWindowQuarters(bundledDebtSnapshot, ["USA"], "10y").at(-1));
    expect(debtWindowQuarters(bundledDebtSnapshot, ["USA"], "5y")).toHaveLength(20);
    expect(debtWindowQuarters(bundledDebtSnapshot, ["USA"], "10y")).toHaveLength(40);
  });
  it("keeps latest monthly financing available independently of a slower quarterly reference", () => {
    const state = {
      ...parseDebtState("?countries=CHN", bundledDebtSnapshot),
      metric: "socialFinancingFlow" as const,
      quarter: "2026-Q1",
    };
    expect(debtTrendEnd(bundledDebtSnapshot, state)).toBe("2026-09");
    expect(debtTrendEnd(bundledDebtSnapshot, { ...state, asOf: "quarter" })).toBe("2026-03");
    const latest = debtCsv(bundledDebtSnapshot, state),
      historic = debtCsv(bundledDebtSnapshot, { ...state, asOf: "quarter" });
    expect(latest).toContain('"2026-09"');
    expect(historic).not.toContain('"2026-09"');
    expect(historic).toContain('"2026-03"');
  });
  it("exports raw precision, zero, negative flow and null with currency, dates and valuation", () => {
    const source = getDebtSeries(bundledDebtSnapshot, "CHN", "corporateBondFlow")!;
    const test: DebtSnapshot = {
      version: 1,
      fetchedAt: source.fetchedAt,
      series: [
        {
          ...source,
          observations: [
            { period: "2026-01", value: 0 },
            { period: "2026-02", value: null },
            { period: "2026-03", value: -0.039312345 },
          ],
        },
      ],
    };
    const state = {
      ...parseDebtState("?countries=CHN", bundledDebtSnapshot),
      quarter: "2026-Q1",
      metric: "corporateBondFlow" as const,
    };
    const csv = debtCsv(test, state);
    expect(csv.startsWith("\uFEFF")).toBe(true);
    expect(csv).toContain('"2026-01","0","trillionLocal","CNY","M","NSA","nominal"');
    expect(csv).toContain('"2026-02","","trillionLocal"');
    expect(csv).toContain('"2026-03","-0.039312345"');
    expect(csv).toContain(source.source.url);
    expect(csv).toContain(source.source.licenseUrl);
  });
  it("keeps official levels and derived growth as separate, attributed series", () => {
    const raw = getDebtSeries(bundledDebtSnapshot, "CHN", "privateCreditStock")!,
      growth = getDebtSeries(bundledDebtSnapshot, "CHN", "creditGrowth")!;
    expect(raw.currency).toBe("CNY");
    expect(growth.currency).toBeNull();
    expect(growth.source.seriesCode).toContain("derived-yoy-4q");
    expect(growth.observations.at(-1)?.status).toMatch(/^derived/u);
    expect(getDebtSeries(bundledDebtSnapshot, "CHN", "creditImpulse")).toBeUndefined();
    expect(debtReadingIsOld(raw, "2026-Q1", "2026-10")).toBe(false);
    expect(debtReadingIsOld({ ...raw, frequency: "A" }, "2020", "2026-10")).toBe(true);
  });
});
