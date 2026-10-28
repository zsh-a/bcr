import { useMemo } from "react";
import { queryEconomicTracks, type EconomicRepository } from "@bcr/market-data/economy";
import { MATRIX_METRICS } from "./presets";
import { pointLabel, trackReading } from "./presentation";
import type { ResearchState } from "./state";

export function ResearchMatrix({
  repository,
  state,
  range,
  cutoff,
  cursor,
  colors,
  onFocus,
  onInspect,
}: {
  repository: EconomicRepository;
  state: ResearchState;
  range: [string, string];
  cutoff: string;
  cursor: string | null;
  colors: Record<string, string>;
  onFocus: (country: string) => void;
  onInspect: (metric: string) => void;
}) {
  const matrix = useMemo(
    () =>
      new Map(
        MATRIX_METRICS.map(([metricId]) => [
          metricId,
          queryEconomicTracks(repository, { metricId, countries: state.countries, range, cutoff }),
        ]),
      ),
    [repository, state.countries.join(","), range, cutoff],
  );
  return (
    <section className="research-matrix" aria-label="经济体核心指标矩阵">
      <div className="research-matrix-scroll" tabIndex={0}>
        <table>
          <caption>同一观察截止，各指标保留实际期次；点击国家聚焦，点击读数展开。</caption>
          <thead>
            <tr>
              <th scope="col">经济体</th>
              {MATRIX_METRICS.map(([id, label, frequency]) => (
                <th key={id} scope="col">
                  <button type="button" onClick={() => onInspect(id)}>
                    {label}
                    <small>{frequency}</small>
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {state.countries.map((id) => (
              <tr key={id} data-focused={state.focus === id}>
                <th scope="row">
                  <button
                    type="button"
                    onClick={() => onFocus(id)}
                    aria-pressed={state.focus === id}
                  >
                    <i style={{ background: colors[id] }} />
                    {repository.countries.find((country) => country.id === id)?.name ?? id}
                  </button>
                </th>
                {MATRIX_METRICS.map(([metricId]) => {
                  const track = matrix.get(metricId)?.find((item) => item.series.country === id);
                  const point = track ? trackReading(track, cursor) : null;
                  return (
                    <td key={metricId}>
                      <button
                        type="button"
                        onClick={() => onInspect(metricId)}
                        aria-label={`${id} ${metricId} 查看数据`}
                      >
                        <strong>{track ? pointLabel(track, cursor) : "—"}</strong>
                        <small>{point?.period ?? (track ? "暂无有效值" : "未收录")}</small>
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
