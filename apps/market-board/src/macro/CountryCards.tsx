import {
  formatMacroValue,
  getMacroSeries,
  latestMacroObservation,
  type MacroIndicatorId,
  type MacroSnapshot,
} from "@bcr/market-data/macro";
import { SERIES_TOKENS } from "./state";

export function CountryCards({
  snapshot,
  countries,
  indicator,
  beforeYear,
}: {
  snapshot: MacroSnapshot;
  countries: string[];
  indicator: MacroIndicatorId;
  beforeYear: number;
}) {
  return (
    <div className="macro-country-cards" aria-label="各国最新可用指标">
      {countries.map((id, index) => {
        const country = snapshot.countries.find((item) => item.id === id);
        const observations = getMacroSeries(snapshot, id, indicator);
        const latest = latestMacroObservation(observations, beforeYear);
        const previous = latest
          ? observations.find((point) => point.year === latest.year - 1)?.value
          : null;
        const change =
          latest?.value !== null &&
          latest?.value !== undefined &&
          previous !== null &&
          previous !== undefined
            ? latest.value - previous
            : null;
        const values = observations.filter((point) => point.year <= beforeYear).slice(-16);
        const finite = values.flatMap((point) => (point.value === null ? [] : [point.value]));
        const min = Math.min(...finite),
          max = Math.max(...finite),
          span = max - min || 1;
        const points = values.map((point, offset) =>
          point.value === null
            ? null
            : `${(offset / Math.max(1, values.length - 1)) * 140},${32 - ((point.value - min) / span) * 28}`,
        );
        const paths: string[][] = [[]];
        for (const point of points) {
          if (point === null) paths.push([]);
          else paths.at(-1)?.push(point);
        }
        return (
          <article
            key={id}
            className="macro-country-card"
            style={{ borderTopColor: `var(${SERIES_TOKENS[index]})` }}
          >
            <header>
              <span
                className="macro-series-dot"
                style={{ background: `var(${SERIES_TOKENS[index]})` }}
              />
              <h2>{country?.name ?? id}</h2>
              <span>{id}</span>
            </header>
            <div className="macro-card-value">
              {formatMacroValue(latest?.value ?? null, indicator)}
            </div>
            <div className="macro-card-bottom">
              <span>
                {latest ? `${latest.year} 年` : "暂无数据"}
                <small>
                  {change === null
                    ? ""
                    : indicator === "gdp" || indicator === "gdpPerCapita"
                      ? `较上年 ${change >= 0 ? "+" : ""}${formatMacroValue(change, indicator)}`
                      : `较上年 ${change >= 0 ? "+" : ""}${change.toFixed(2)} 个百分点`}
                </small>
              </span>
              <svg viewBox="0 0 144 36" aria-hidden="true">
                {paths
                  .filter((path) => path.length > 1)
                  .map((path, pathIndex) => (
                    <polyline
                      key={pathIndex}
                      points={path.join(" ")}
                      fill="none"
                      stroke={`var(${SERIES_TOKENS[index]})`}
                      strokeWidth="1.8"
                    />
                  ))}
              </svg>
            </div>
          </article>
        );
      })}
    </div>
  );
}
