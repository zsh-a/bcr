import { describe, expect, it } from "vitest";
import {
  MACRO_EVENTS,
  MACRO_EVENT_CATALOG_UPDATED_AT,
  MACRO_EVENT_LATEST_DATE,
  MACRO_EVENT_CATEGORIES,
  filterMacroEvents,
  type MacroEvent,
} from "../src/macro/events";

describe("curated macro history", () => {
  it("includes sourced recent events without treating announcements as implementation", () => {
    expect(MACRO_EVENT_LATEST_DATE >= "2026-10-19").toBe(true);
    expect(MACRO_EVENT_LATEST_DATE <= MACRO_EVENT_CATALOG_UPDATED_AT).toBe(true);
    for (const country of ["CHN", "USA", "JPN", "DEU", "GBR"]) {
      expect(
        filterMacroEvents(MACRO_EVENTS, [country], [2025, 2026], "policy").some((item) =>
          item.countries.includes(country),
        ),
      ).toBe(true);
    }
    const tariffs = filterMacroEvents(MACRO_EVENTS, ["CHN"], [2025, 2025], "trade");
    expect(tariffs.map((item) => item.id)).toContain("us-china-geneva-2025");
    expect(tariffs.map((item) => item.id)).toContain("us-reciprocal-tariffs-2025");
    expect(
      MACRO_EVENTS.find((item) => item.id === "pboc-liquidity-framework-2026")?.summary,
    ).toContain("拟设");
    expect(
      MACRO_EVENTS.find((item) => item.id === "iea-emergency-oil-release-2026")?.summary,
    ).toContain("不是全部释放完成日");
    expect(MACRO_EVENTS.find((item) => item.id === "fed-hike-2026")?.sources).toHaveLength(2);
    expect(MACRO_EVENTS.every((item) => item.start <= MACRO_EVENT_CATALOG_UPDATED_AT)).toBe(true);
  });

  it("preserves source precision and valid, sourced interval boundaries", () => {
    const ids = new Set<string>();
    const categories = new Set(MACRO_EVENT_CATEGORIES.map((item) => item.id));
    expect(MACRO_EVENTS.length).toBeGreaterThanOrEqual(35);
    for (const item of MACRO_EVENTS) {
      expect(ids.has(item.id), item.id).toBe(false);
      ids.add(item.id);
      expect(categories.has(item.category), item.id).toBe(true);
      const pattern = { year: /^\d{4}$/, month: /^\d{4}-\d{2}$/, day: /^\d{4}-\d{2}-\d{2}$/ }[
        item.precision
      ];
      for (const date of [item.start, ...(item.end ? [item.end] : [])]) {
        expect(date, item.id).toMatch(pattern);
        const iso =
          item.precision === "year"
            ? `${date}-01-01`
            : item.precision === "month"
              ? `${date}-01`
              : date;
        expect(new Date(iso).toISOString().slice(0, 10), item.id).toBe(iso);
      }
      if (item.end) expect(item.end >= item.start, item.id).toBe(true);
      expect(new Set(item.countries).size, item.id).toBe(item.countries.length);
      expect(
        item.countries.every((id) => /^[A-Z]{3}$/.test(id)),
        item.id,
      ).toBe(true);
      expect(item.summary.length, item.id).toBeGreaterThan(20);
      expect(item.mechanism, item.id).toMatch(/^观察方向：/);
      expect(item.sources.length, item.id).toBeGreaterThan(0);
      const urls = item.sources.map((source) => source.url);
      expect(new Set(urls).size, item.id).toBe(urls.length);
      for (const source of item.sources) {
        expect(source.title.length, item.id).toBeGreaterThan(3);
        expect(new URL(source.url).protocol, item.id).toBe("https:");
      }
    }
  });

  it("finds an ongoing episode when its start is outside the selected window", () => {
    const events = filterMacroEvents(MACRO_EVENTS, ["USA"], [2008, 2008], "crisis");
    expect(events.map((item) => item.id)).toContain("us-great-recession");
    expect(events.map((item) => item.id)).toContain("lehman-2008");
    expect(events.map((item) => item.id)).not.toContain("us-recession-2001");
    expect(
      filterMacroEvents(MACRO_EVENTS, ["USA"], [2010, 2010], "crisis").map((item) => item.id),
    ).not.toContain("us-great-recession");
  });

  it("combines category, global context, and country intersection without duplicates", () => {
    const chinaHealth = filterMacroEvents(MACRO_EVENTS, ["CHN"], [2000, 2024], "health");
    expect(chinaHealth.map((item) => item.id)).toEqual([
      "sars-alert-2003",
      "covid-pandemic-2020",
      "covid-emergency-end-2023",
    ]);
    const japanesePolicy = filterMacroEvents(MACRO_EVENTS, ["JPN"], [2013, 2024], "policy");
    expect(japanesePolicy.map((item) => item.id)).toEqual([
      "boj-qqe-2013",
      "boj-negative-rates-2016",
      "boj-framework-2024",
    ]);
    const bilateral = filterMacroEvents(MACRO_EVENTS, ["USA", "CHN"], [2018, 2018], "trade");
    expect(bilateral.map((item) => item.id)).toEqual(["us-china-tariffs-2018"]);
  });

  it("handles an empty country filter as all countries and rejects invalid ranges", () => {
    expect(
      filterMacroEvents(
        MACRO_EVENTS,
        [],
        [1980, Number(MACRO_EVENT_CATALOG_UPDATED_AT.slice(0, 4))],
        "all",
      ),
    ).toHaveLength(MACRO_EVENTS.length);
    expect(filterMacroEvents(MACRO_EVENTS, ["IND"], [2025, 1980], "all")).toEqual([]);
    expect(filterMacroEvents(MACRO_EVENTS, [], [NaN, 2025], "all")).toEqual([]);
    expect(filterMacroEvents([], [], [1980, 2025], "all")).toEqual([]);
  });

  it("includes boundary years while keeping caller data and ordering intact", () => {
    const seeds: MacroEvent[] = [
      {
        ...MACRO_EVENTS[0]!,
        id: "overlap",
        start: "2000",
        end: "2010",
        precision: "year",
        countries: [],
      },
    ];
    expect(filterMacroEvents(seeds, ["BRA"], [2010, 2010], "all")).toEqual(seeds);
    expect(filterMacroEvents(seeds, ["BRA"], [2011, 2011], "all")).toEqual([]);
    expect(seeds[0]?.start).toBe("2000");
  });
});
