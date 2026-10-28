import { describe, expect, it } from "vitest";
import { bundledMacroSnapshot } from "@bcr/market-data/macro";
import { bundledCycleSnapshot } from "@bcr/market-data/cycle";
import { bundledDebtSnapshot } from "@bcr/market-data/debt";
import { cycleViewUrl, parseCycleState } from "../src/cycle/state";
import { debtStateUrl, parseDebtState } from "../src/debt/state";
import { macroStateUrl, parseMacroState } from "../src/macro/state";
import { legacyWorkspaceUrl } from "../src/research/legacy-state";
import {
  parseResearchState,
  researchCutoff,
  researchStateUrl,
  type ResearchContext,
  type ResearchPreset,
} from "../src/research/state";

const context: ResearchContext = {
  countryIds: ["CHN", "USA", "JPN", "DEU", "GBR", "IND", "BRA"],
  metricIds: [
    "annual:growth",
    "annual:inflation",
    "cycle:cli",
    "cycle:policyRate",
    "cycle:inflation",
    "cycle:unemployment",
    "debt:privateDebt",
    "debt:creditGap",
    "debt:householdDebt",
    "debt:corporateDebt",
  ],
  minDate: "1980-01-01",
  maxDate: "2026-10-25",
};
const search = (url: string) => new URL(url, "https://example.test").search;
const parse = (query = "") => parseResearchState(query, context);
const params = (url: string) => new URLSearchParams(search(url));

describe("shared macro research state", () => {
  it("uses the global country catalog, independent of monthly coverage", () => {
    expect(parse()).toMatchObject({
      countries: ["CHN", "USA", "JPN", "DEU"],
      focus: "CHN",
      from: "2021-10-01",
      to: "2026-10-25",
      date: "2026-10-25",
      asOf: "latest",
      preset: "overview",
      pins: [],
      event: null,
    });
    expect(parse("?countries=IND,BRA,USA,IND& rFocus=IND".replace("& ", "&"))).toMatchObject({
      countries: ["IND", "BRA", "USA"],
      focus: "IND",
    });
    expect(parse("?countries=unknown&rFocus=xxx").countries).toEqual(["CHN", "USA", "JPN", "DEU"]);
    expect(parse("?countries=USA&rFocus=IND").focus).toBe("USA");
  });

  it("retains all shared selections and pins across every preset and URL refresh", () => {
    const initial = parse(
      "?countries=IND,USA&rFocus=USA&rFrom=2000-01-01&rTo=2025-12-31&rDate=2024-02-29&rAsOf=date&rPreset=growth&rPins=annual:growth,debt:privateDebt&rEvent=lehman-2008",
    );
    for (const preset of [
      "overview",
      "growth",
      "prices",
      "credit",
      "labor",
      "confidence",
      "history",
    ] as ResearchPreset[]) {
      const state = { ...initial, preset };
      const url = researchStateUrl(
        state,
        "?cycleMetric=policyRate&cycleWindow=10y&period=2025-06&custom=keep",
      );
      expect(parse(search(url))).toEqual(state);
      expect(params(url).get("cycleMetric")).toBe("policyRate");
      expect(params(url).get("custom")).toBe("keep");
    }
  });

  it("filters exact metric IDs, removes duplicates, and caps manual pins at eight", () => {
    const state = parse(
      `?rPins=unknown,percent,cycle:policyRate,cycle:policyRate,${context.metricIds.join(",")}`,
    );
    expect(state.pins).toEqual(
      ["cycle:policyRate", ...context.metricIds.filter((id) => id !== "cycle:policyRate")].slice(
        0,
        8,
      ),
    );
    expect(
      parse("?rPins=cycle:policyRate:percent,annual:growth& rPreset=unknown".replace("& ", "&")),
    ).toMatchObject({ pins: ["annual:growth"], preset: "overview" });
  });

  it("validates real days, clamps bounds and orders ranges without Date.parse rollover", () => {
    expect(parse("?rFrom=2025-02-30&rTo=2026-13-01&rDate=2025-02-29&rAsOf=date")).toMatchObject({
      from: "2021-10-01",
      to: "2026-10-25",
      date: "2026-10-25",
    });
    expect(parse("?rFrom=2099-01-01&rTo=1900-01-01&rDate=2099-12-31&rAsOf=date")).toMatchObject({
      from: "1980-01-01",
      to: "1980-01-01",
      date: "1980-01-01",
    });
    expect(parse("?rFrom=2025-01-01&rTo=2024-02-29&rDate=2024-02-29&rAsOf=date")).toMatchObject({
      from: "2024-02-29",
      to: "2024-02-29",
      date: "2024-02-29",
    });
    expect(parse("?rDate=2000-02-29&rAsOf=date").date).toBe("2000-02-29");
    expect(parse("?rDate=1900-02-29&rAsOf=date").date).toBe(context.maxDate);
  });

  it("keeps latest as a mode and the unused reference date separate from the visible end", () => {
    const latest = parse("?rTo=2024-12-31&rDate=2020-01-01&rAsOf=latest");
    expect(latest.date).toBe("2020-01-01");
    expect(researchCutoff(latest, context.maxDate)).toBe("2024-12-31");
    expect(researchCutoff({ ...latest, asOf: "date" }, context.maxDate)).toBe("2020-01-01");
    expect(parse("?rTo=2024-12-31&rAsOf=latest").date).toBe(context.maxDate);
    expect(parse("?rDate=null&rAsOf=unknown&rEvent=unknown")).toMatchObject({
      date: context.maxDate,
      asOf: "latest",
      event: null,
    });
  });

  it("round trips intentional empty countries and null focus/event and removes stale optional keys", () => {
    const state = { ...parse("?countries=&rFocus="), event: null, pins: [] };
    const url = researchStateUrl(state, "?rEvent=lehman-2008&rFocus=USA&rPins=cycle:cli");
    expect(parse(search(url))).toEqual(state);
    expect(params(url).has("rEvent")).toBe(false);
    expect(params(url).get("rFocus")).toBe("");
    expect(params(url).get("rPins")).toBe("");
  });
});

describe("old link import and classic view compatibility", () => {
  it("imports monthly, quarterly and annual reference periods with native period ends", () => {
    expect(
      parse(
        "?layer=cycle&countries=IND,USA&cycleFocus=IND&period=2024-02&cycleWindow=10y&cycleMetric=policyRate",
      ),
    ).toMatchObject({
      countries: ["IND", "USA"],
      focus: "IND",
      date: "2024-02-29",
      asOf: "date",
      from: "2014-02-01",
      pins: ["cycle:policyRate"],
    });
    expect(
      parse("?layer=debt&debtQuarter=2025-Q1&debtAsOf=quarter&debtMetric=creditGap&debtWindow=all"),
    ).toMatchObject({
      date: "2025-03-31",
      asOf: "date",
      from: "1980-01-01",
      pins: ["debt:creditGap"],
    });
    expect(
      parse(
        "?layer=history&from=1990&to=2024&year=2008&mode=phase&indicator=growth&event=lehman-2008",
      ),
    ).toMatchObject({
      from: "1990-01-01",
      to: "2024-12-31",
      date: "2008-12-31",
      asOf: "date",
      pins: ["annual:growth"],
      event: "lehman-2008",
    });
    expect(parse("?layer=history&to=2010&mode=phase").date).toBe("2010-12-31");
  });

  it("ignores invalid legacy dates and indicators and never makes a latest reference a historical cutoff", () => {
    expect(parse("?layer=cycle&period=2025-13&cycleMetric=percent&cycleAsOf=latest")).toMatchObject(
      { date: context.maxDate, asOf: "latest", pins: [] },
    );
    expect(parse("?layer=debt&debtQuarter=2025-Q5&debtAsOf=latest")).toMatchObject({
      date: context.maxDate,
      asOf: "latest",
    });
    expect(parse("?layer=cycle&period=2025-06&cycleWindow=10y&cycleAsOf=latest")).toMatchObject({
      date: context.maxDate,
      asOf: "latest",
      from: "2016-10-01",
    });
    const explicit =
      "?layer=cycle&period=2008-09&cycleMetric=policyRate&rDate=2026-10-25&rAsOf=latest&rPins=annual:growth";
    expect(parse(explicit)).toMatchObject({
      date: context.maxDate,
      asOf: "latest",
      pins: ["annual:growth"],
    });
  });

  it("preserves cycle policy-rate/10-year/June-2025 when debt changes a metric, including a history detour", () => {
    const original =
      "?view=macro&layer=cycle&countries=USA,IND&period=2025-06&cycleMetric=policyRate&cycleWindow=10y&cycleFocus=USA&custom=kept";
    const toDebt = search(legacyWorkspaceUrl("debt", original));
    const debt = parseDebtState(toDebt, bundledDebtSnapshot);
    const editedDebt = search(debtStateUrl({ ...debt, metric: "creditGap" }, toDebt));
    const toHistory = search(legacyWorkspaceUrl("history", editedDebt));
    const history = parseMacroState(toHistory, bundledMacroSnapshot.countries);
    const editedHistory = search(macroStateUrl({ ...history, indicator: "inflation" }, toHistory));
    const back = search(legacyWorkspaceUrl("cycle", editedHistory));
    expect(parseCycleState(back, bundledCycleSnapshot)).toMatchObject({
      countries: ["USA"],
      metric: "policyRate",
      window: "10y",
      period: "2025-06",
      focus: "USA",
    });
    expect(new URLSearchParams(back).get("debtMetric")).toBe("creditGap");
    expect(new URLSearchParams(back).get("indicator")).toBe("inflation");
    expect(new URLSearchParams(back).get("custom")).toBe("kept");
  });

  it("retains global unsupported economies on metric updates and domain country changes", () => {
    const original = "?layer=cycle&countries=IND,USA,BRA,JPN&period=2025-06&cycleFocus=USA";
    const cycle = parseCycleState(original, bundledCycleSnapshot);
    expect(cycle.countries).toEqual(["USA", "JPN"]);
    const metric = params(cycleViewUrl({ ...cycle, metric: "policyRate" }, original));
    expect(metric.get("countries")).toBe("IND,USA,BRA,JPN");
    const removed = params(cycleViewUrl({ ...cycle, countries: ["JPN"], focus: "JPN" }, original));
    expect(removed.get("countries")).toBe("IND,BRA,JPN");
    const debtSearch = search(legacyWorkspaceUrl("debt", `?${metric}`));
    const debt = parseDebtState(debtSearch, bundledDebtSnapshot);
    expect(
      params(debtStateUrl({ ...debt, metric: "creditGap" }, debtSearch)).get("countries"),
    ).toBe("IND,USA,BRA,JPN");
    const unsupported = "?layer=debt&countries=IND,BRA";
    expect(
      params(debtStateUrl(parseDebtState(unsupported, bundledDebtSnapshot), unsupported)).get(
        "countries",
      ),
    ).toBe("IND,BRA");
  });

  it("deletes optional classic keys when returning to default mode, focus and event", () => {
    const original = "?cycleMode=3d&cycleAsOf=latest&cycleFocus=USA&debtMetric=creditGap";
    const state = parseCycleState(original, bundledCycleSnapshot);
    const next = params(
      cycleViewUrl({ ...state, mode: "2d", asOf: "period", focus: null }, original),
    );
    for (const key of ["cycleMode", "cycleAsOf", "cycleFocus"]) expect(next.has(key)).toBe(false);
    expect(next.get("debtMetric")).toBe("creditGap");
    const macroSearch =
      "?mode=phase&year=2008&category=crisis&event=lehman-2008&cycleMetric=policyRate";
    const macro = parseMacroState(macroSearch, bundledMacroSnapshot.countries);
    const cleared = params(
      macroStateUrl({ ...macro, mode: "trend", category: "all", event: null }, macroSearch),
    );
    for (const key of ["mode", "year", "category", "event"]) expect(cleared.has(key)).toBe(false);
    expect(cleared.get("layer")).toBe("history");
    expect(cleared.get("cycleMetric")).toBe("policyRate");
  });

  it("keeps explicit research latest dates, global focus and pins through classic metric changes", () => {
    const shared = parse(
      "?countries=IND,USA&rFocus=IND&rFrom=2010-01-01&rDate=2026-10-25&rTo=2026-10-25&rAsOf=latest&rPins=annual:growth,debt:creditGap",
    );
    const cycleSearch = search(legacyWorkspaceUrl("cycle", search(researchStateUrl(shared))));
    const cycle = parseCycleState(cycleSearch, bundledCycleSnapshot);
    expect(cycle.focus).toBe("USA");
    const edited = search(cycleViewUrl({ ...cycle, metric: "policyRate" }, cycleSearch));
    expect(parse(search(legacyWorkspaceUrl("research", edited)))).toEqual(shared);
    const focused = search(cycleViewUrl({ ...cycle, focus: "USA" }, cycleSearch));
    expect(parse(focused).asOf).toBe("latest");
  });

  it("syncs intentional classic reference-date and focus edits to an existing shared selection", () => {
    const shared = parse("?countries=USA,JPN&rFocus=USA&rAsOf=latest&rPins=annual:growth");
    const cycleSearch = search(legacyWorkspaceUrl("cycle", search(researchStateUrl(shared))));
    const cycle = parseCycleState(cycleSearch, bundledCycleSnapshot);
    const changed = search(
      cycleViewUrl(
        { ...cycle, period: "2025-06", asOf: "period", focus: "JPN", window: "10y" },
        cycleSearch,
      ),
    );
    expect(parse(search(legacyWorkspaceUrl("research", changed)))).toMatchObject({
      focus: "JPN",
      date: "2025-06-30",
      asOf: "date",
      from: "2015-06-01",
      pins: ["annual:growth"],
    });
  });

  it("imports the source classic layer on return and preserves all independent domain parameters", () => {
    const old =
      "?layer=debt&countries=USA,IND&debtQuarter=2025-Q3&debtAsOf=quarter&debtMetric=creditGap&debtFocus=USA&cycleMetric=policyRate&period=2025-06";
    const back = legacyWorkspaceUrl("research", old);
    expect(params(back).get("layer")).toBe("research");
    expect(params(back).get("cycleMetric")).toBe("policyRate");
    expect(parse(search(back))).toMatchObject({
      countries: ["USA", "IND"],
      focus: "USA",
      date: "2025-09-30",
      asOf: "date",
      pins: ["debt:creditGap"],
    });
    expect(
      parse(
        search(legacyWorkspaceUrl("research", old.replace("debtAsOf=quarter", "debtAsOf=latest"))),
      ).asOf,
    ).toBe("latest");
  });
});
