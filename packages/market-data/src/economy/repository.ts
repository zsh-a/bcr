import { CYCLE_COUNTRIES } from "../cycle/catalog";
import type { CycleSnapshot } from "../cycle/model";
import { bundledCycleSnapshot } from "../cycle/snapshot";
import type { DebtSnapshot } from "../debt/model";
import { bundledDebtSnapshot } from "../debt/snapshot";
import type { MacroSnapshot } from "../macro/model";
import { bundledMacroSnapshot } from "../macro/snapshot";
import { adaptAnnualSnapshot, adaptCycleSnapshot, adaptDebtSnapshot } from "./adapters";
import { createEconomicMetrics } from "./catalog";
import type { EconomicCountry, EconomicRepository, EconomicSeries } from "./model";

/** Omitted domains use the bundled resource; explicit null excludes a domain. No network requests. */
export interface EconomicSnapshots {
  annual?: MacroSnapshot | null;
  cycle?: CycleSnapshot | null;
  debt?: DebtSnapshot | null;
}
export function createEconomicRepository(input: EconomicSnapshots = {}): EconomicRepository {
  const annual = input.annual === undefined ? bundledMacroSnapshot : input.annual;
  const cycle = input.cycle === undefined ? bundledCycleSnapshot : input.cycle;
  const debt = input.debt === undefined ? bundledDebtSnapshot : input.debt;
  const series = [
    ...(annual ? adaptAnnualSnapshot(annual) : []),
    ...(cycle ? adaptCycleSnapshot(cycle) : []),
    ...(debt ? adaptDebtSnapshot(debt) : []),
  ];
  const directory = new Map<string, EconomicCountry>(
    CYCLE_COUNTRIES.map((country) => [country.id, { ...country }]),
  );
  for (const country of annual?.countries ?? []) directory.set(country.id, { ...country });
  const countries = new Map<string, EconomicCountry>();
  const index = new Map<string, EconomicSeries>();
  let minDate = "",
    maxDate = "";
  for (const item of series) {
    const key = `${item.country}:${item.metricId}`;
    if (index.has(key)) throw new Error(`经济仓库存在重复国家/指标：${key}`);
    index.set(key, item);
    countries.set(
      item.country,
      directory.get(item.country) ?? {
        id: item.country,
        iso2: "",
        name: item.country,
        englishName: item.country,
        region: "未提供",
      },
    );
    const first = item.observations[0]?.date,
      last = item.observations.at(-1)?.date;
    if (first && (!minDate || first < minDate)) minDate = first;
    if (last && (!maxDate || last > maxDate)) maxDate = last;
  }
  const snapshots = [annual, cycle, debt].filter((value) => value !== null);
  const fetchedAt =
    snapshots
      .map((value) => value.fetchedAt)
      .sort((left, right) => Date.parse(left) - Date.parse(right))
      .at(-1) ?? "";
  return {
    countries: [...countries.values()].sort((a, b) => a.name.localeCompare(b.name, "zh-CN")),
    metrics: createEconomicMetrics(series),
    series,
    fetchedAt,
    minDate,
    maxDate,
    getSeries: (country, metricId) => index.get(`${country}:${metricId}`),
  };
}
