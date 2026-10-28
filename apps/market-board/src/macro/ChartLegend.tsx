import {
  formatMacroValue,
  getMacroSeries,
  latestMacroObservation,
  type MacroSnapshot,
} from "@bcr/market-data/macro";
import { SERIES_TOKENS, type MacroViewState } from "./state";

export function ChartLegend({
  snapshot,
  state,
  focusedCountry,
  hoverYear,
  onFocus,
}: {
  snapshot: MacroSnapshot;
  state: MacroViewState;
  focusedCountry: string | null;
  hoverYear: number | null;
  onFocus: (country: string | null) => void;
}) {
  return (
    <div className="macro-chart-readout">
      <div className="macro-legend" aria-label="图例与年度读数">
        {state.countries.map((id, index) => {
          const name = snapshot.countries.find((country) => country.id === id)?.name ?? id;
          const points = getMacroSeries(snapshot, id, state.indicator);
          const point =
            hoverYear === null
              ? latestMacroObservation(points, state.range[1])
              : points.find((item) => item.year === hoverYear);
          const phase = (indicator: "growth" | "inflation") =>
            getMacroSeries(snapshot, id, indicator).find((item) => item.year === state.year)
              ?.value ?? null;
          return (
            <button
              type="button"
              key={id}
              aria-label={`聚焦${name}曲线`}
              aria-pressed={focusedCountry === id}
              className="macro-legend-country"
              data-dimmed={focusedCountry !== null && focusedCountry !== id}
              onClick={() => onFocus(focusedCountry === id ? null : id)}
            >
              <span>
                <i style={{ background: `var(${SERIES_TOKENS[index]})` }} />
                {name}
                <small>
                  {state.mode === "phase"
                    ? "增长 / 通胀"
                    : `${point?.year ?? hoverYear ?? state.range[1]}`}
                </small>
              </span>
              <strong>
                {state.mode === "phase"
                  ? `${formatMacroValue(phase("growth"), "growth")} / ${formatMacroValue(phase("inflation"), "inflation")}`
                  : formatMacroValue(point?.value ?? null, state.indicator)}
              </strong>
            </button>
          );
        })}
      </div>
      <div className="macro-readout-period" data-hovering={hoverYear !== null}>
        <span>{state.mode === "phase" ? state.year : (hoverYear ?? state.range[1])}</span>
        <small>
          {state.mode === "phase"
            ? "固定坐标 · 年度"
            : hoverYear === null
              ? "截至该年 · 最新可用"
              : "年度观测"}
        </small>
      </div>
      <p className="macro-legend-hint">
        {focusedCountry ? (
          <button type="button" onClick={() => onFocus(null)}>
            显示全部曲线
          </button>
        ) : (
          "点击国家聚焦 · 悬停图表读取年份"
        )}
      </p>
    </div>
  );
}
