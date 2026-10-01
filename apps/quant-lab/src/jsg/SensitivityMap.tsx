import { useState } from "react";
import { Select } from "@bcr/react";
import type { SelectedGrid } from "./session";
import { GRID_FIELDS, type GridMetric } from "./grid";
import { percent } from "./Orders";

export function SensitivityMap({
  grid,
  onView,
  busy,
}: {
  grid: SelectedGrid;
  onView: (index: number) => void;
  busy: boolean;
}) {
  const [metric, setMetric] = useState<GridMetric>("totalReturn"),
    [filters, setFilters] = useState<Record<string, number>>({});
  const axes = grid.run.axes;
  if (axes.length < 2) return null;
  const x = axes[0]!.field,
    y = axes[1]!.field;
  const values = (field: typeof x) =>
    [...new Set(grid.result.results.map((r) => r.config[field]))].sort((a, b) => a - b);
  const xs = values(x),
    ys = values(y),
    rest = axes.slice(2);
  const rows = grid.result.results
    .map((r, index) => ({ ...r, index }))
    .filter((r) =>
      rest.every((a) => r.config[a.field] === (filters[a.field] ?? values(a.field)[0])),
    );
  const scale = Math.max(1e-9, ...rows.map((r) => Math.abs(r.metrics[metric])));
  const label = (field: typeof x, value: number) =>
    `${Number((value * GRID_FIELDS[field].scale).toFixed(8))}${GRID_FIELDS[field].unit}`;
  return (
    <section className="research-sensitivity" aria-label="参数敏感性热图">
      <div className="research-insights-tools">
        <h3>参数敏感性</h3>
        <Select
          aria-label="敏感性指标"
          value={metric}
          onChange={(e) => setMetric(e.target.value as GridMetric)}
        >
          <option value="totalReturn">总收益</option>
          <option value="maxDrawdown">最大回撤</option>
          <option value="sharpe">Sharpe</option>
          <option value="fees">费用</option>
        </Select>
        {rest.map((a) => (
          <label key={a.field}>
            {GRID_FIELDS[a.field].label}
            <Select
              value={filters[a.field] ?? values(a.field)[0]}
              onChange={(e) => setFilters((f) => ({ ...f, [a.field]: Number(e.target.value) }))}
            >
              {values(a.field).map((v) => (
                <option key={v} value={v}>
                  {label(a.field, v)}
                </option>
              ))}
            </Select>
          </label>
        ))}
      </div>
      <div className="research-insights-scroll">
        <table className="research-sensitivity-table">
          <caption>
            {GRID_FIELDS[y].label} × {GRID_FIELDS[x].label} · 点击查看完整回测
          </caption>
          <thead>
            <tr>
              <th>
                {GRID_FIELDS[y].label} / {GRID_FIELDS[x].label}
              </th>
              {xs.map((v) => (
                <th key={v}>{label(x, v)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ys.map((v) => (
              <tr key={v}>
                <th>{label(y, v)}</th>
                {xs.map((u) => {
                  const row = rows.find((r) => r.config[x] === u && r.config[y] === v),
                    value = row?.metrics[metric];
                  return (
                    <td key={u}>
                      {row && value !== undefined ? (
                        <button
                          disabled={busy}
                          onClick={() => onView(row.index)}
                          style={{
                            background: `color-mix(in srgb, var(--color-${value >= 0 ? "accent" : "danger"}) ${8 + (Math.abs(value) / scale) * 32}%, var(--color-surface))`,
                          }}
                          aria-label={`${GRID_FIELDS[y].label} ${label(y, v)}，${GRID_FIELDS[x].label} ${label(x, u)}，${metric} ${value}`}
                        >
                          {metric === "totalReturn" || metric === "maxDrawdown"
                            ? percent(value)
                            : value.toFixed(2)}
                        </button>
                      ) : (
                        "—"
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="research-help">其余维度按选定值固定，不对不同配置的收益取平均。</p>
    </section>
  );
}
