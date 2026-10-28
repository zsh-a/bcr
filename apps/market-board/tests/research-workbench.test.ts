import { describe, expect, it } from "vitest";
import {
  bundledEconomicRepository as repository,
  queryEconomicTracks,
} from "@bcr/market-data/economy";
import { parseResearchState, researchCutoff } from "../src/research/state";
import { researchMetrics } from "../src/research/presets";
import { trackReading } from "../src/research/presentation";
import { nativePoint } from "../src/research/interaction";
import { manifest } from "../src/app-manifest";

const context = {
  countryIds: repository.countries.map((country) => country.id),
  metricIds: repository.metrics.map((metric) => metric.id),
  minDate: repository.minDate,
  maxDate: repository.maxDate,
};
describe("integrated research selection and reference dates", () => {
  it("keeps the overview populated in country comparison mode without a focused country", () => {
    const state = parseResearchState("?countries=CHN,USA&rFocus=", context);
    expect(state.focus).toBeNull();
    expect(researchMetrics(repository, state)).toHaveLength(8);
    expect(researchMetrics(repository, state).map((metric) => metric.id)).toContain(
      "cycle:policyRate",
    );
  });
  it("offers annual background for a country without bundled monthly coverage while retaining pins", () => {
    const state = parseResearchState(
      "?countries=IND,USA&rFocus=IND&rPins=cycle:loanStandards",
      context,
    );
    expect(state.countries).toEqual(["IND", "USA"]);
    const metrics = researchMetrics(repository, state);
    expect(metrics.filter((metric) => metric.domain === "annual")).toHaveLength(6);
    expect(metrics.map((metric) => metric.id)).toContain("cycle:loanStandards");
    expect(metrics.map((metric) => metric.id)).not.toContain("cycle:unemployment");
  });
  it("keeps source nulls under a shared historical cursor, consistent with the chart tooltip", () => {
    const track = queryEconomicTracks(repository, {
      metricId: "cycle:coreInflation3m",
      countries: ["USA"],
      range: ["2025-09-01", "2025-12-31"],
      cutoff: "2025-12-31",
    })[0]!;
    const reading = trackReading(track, "2025-11-30");
    expect(reading?.period).toBe("2025-11");
    expect(reading?.value).toBeNull();
    expect(reading).toEqual(nativePoint(track.points, "2025-11-30"));
    expect(trackReading(track, "2025-08-31")).toBeNull();
  });
  it("anchors an otherwise unspecified historical window to its reference date", () => {
    const state = parseResearchState("?rDate=2000-02-29&rAsOf=date", context);
    expect(state.from).toBe("1995-02-01");
    expect(researchCutoff(state, repository.maxDate)).toBe("2000-02-29");
    const bounded = parseResearchState("?countries=CHN,USA,JPN,DEU,GBR,IND,FRA", context);
    expect(bounded.countries).toHaveLength(6);
  });
  it("preserves typed research links through both hosts and rejects impossible calendar dates", () => {
    expect(
      manifest.validateSearch({
        layer: "research",
        rFrom: "2024-02-29",
        rTo: "2025-02-30",
        rDate: "2025-13-01",
        rAsOf: "date",
        rFocus: "",
        rPins: "annual:gdp,cycle:inflation",
        rPreset: "credit",
      }),
    ).toMatchObject({
      layer: "research",
      rFrom: "2024-02-29",
      rTo: undefined,
      rDate: undefined,
      rAsOf: "date",
      rFocus: "",
      rPins: "annual:gdp,cycle:inflation",
      rPreset: "credit",
    });
  });
});
