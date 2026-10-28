/** Run with `bun scripts/sync-macro-data.ts` to replace the bundled real-data snapshot. */
import { randomUUID } from "node:crypto";
import { rename, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { MACRO_END_YEAR, MACRO_START_YEAR } from "../packages/market-data/src/macro/catalog";
import { fetchWorldBankSnapshot } from "../packages/market-data/src/macro/worldbank";

const output = fileURLToPath(
  new URL("../packages/market-data/src/macro/worldbank-snapshot.json", import.meta.url),
);
const started = performance.now();
console.log(
  `[macro] Fetching World Bank WDI, ${MACRO_START_YEAR}–${MACRO_END_YEAR}, all economies, six indicators`,
);
const snapshot = await fetchWorldBankSnapshot([]);
console.log(
  `[macro] Received ${snapshot.countries.length} economies and ${snapshot.series.length} series; source updated ${snapshot.sourceUpdatedAt}`,
);
// Keep the ingestion path independent from the existing snapshot so it can bootstrap or repair it.
const compact = {
  version: 1,
  source: "World Bank: World Development Indicators",
  sourceUrl: "https://databank.worldbank.org/source/world-development-indicators",
  license: "https://data.worldbank.org/summary-terms-of-use",
  fetchedAt: snapshot.fetchedAt,
  sourceUpdatedAt: snapshot.sourceUpdatedAt,
  startYear: MACRO_START_YEAR,
  endYear: MACRO_END_YEAR,
  countries: snapshot.countries.map((country) => [
    country.id,
    country.iso2,
    country.name,
    country.englishName,
    country.region,
  ]),
  series: snapshot.series.map((series) => {
    const first = series.observations.findIndex((observation) => observation.value !== null);
    if (first === -1) return [series.country, series.indicator, MACRO_START_YEAR, []];
    let end = series.observations.length;
    while (end > first && series.observations[end - 1]?.value === null) end -= 1;
    return [
      series.country,
      series.indicator,
      series.observations[first]?.year ?? MACRO_START_YEAR,
      series.observations.slice(first, end).map((observation) => observation.value),
    ];
  }),
};
const content = JSON.stringify(compact);
const populated = snapshot.series
  .flatMap((series) => series.observations)
  .filter((observation) => observation.value !== null).length;
if (snapshot.countries.length < 150 || populated < 20_000)
  throw new Error("Incomplete global response; existing snapshot was preserved");
// Stage next to the destination for atomic rename, with independent files for concurrent runs.
const temporary = `${output}.${process.pid}.${randomUUID()}.tmp`;
try {
  await writeFile(temporary, `${content}\n`, { encoding: "utf8", flag: "wx" });
  await rename(temporary, output);
} finally {
  await rm(temporary, { force: true });
}
console.log(
  `[macro] Atomically wrote ${populated} actual observations (${(new TextEncoder().encode(content).length / 1024).toFixed(1)} KiB) in ${((performance.now() - started) / 1000).toFixed(1)}s`,
);
console.log(`[macro] ${output}`);
