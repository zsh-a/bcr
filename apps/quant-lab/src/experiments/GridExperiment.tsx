import { dateText } from "@bcr/market-data/research/model";
import { type JsgConfig } from "@bcr/quant-core";
import { Button, Dialog, IconButton, Input, Select } from "@bcr/react";
import { ChevronDown, ChevronUp, Download, FlaskConical, Plus, Trash2 } from "lucide-react";
import { useId, useState } from "react";
import { money, percent } from "../results/format";
import type { SelectedGrid } from "../session/model";
import {
  GRID_FIELDS,
  gridConfigs,
  gridValue,
  MAX_GRID_CONFIGS,
  rankGrid,
  type GridAxis,
  type GridField,
  type GridMetric,
} from "./grid";
import { SensitivityMap } from "./SensitivityMap";

export function GridSettings({
  open,
  base,
  source,
  busy,
  onClose,
  onRun,
}: {
  open: boolean;
  base: JsgConfig;
  source: string;
  busy: boolean;
  onClose: () => void;
  onRun: (configs: JsgConfig[], axes: GridAxis[]) => void;
}) {
  const id = useId();
  const [axes, setAxes] = useState<GridAxis[]>([
    { field: "stockCount", values: `${Math.max(1, base.stockCount - 4)}, ${base.stockCount}` },
    { field: "stopLoss", values: "0, 5" },
  ]);
  let configs: JsgConfig[] = [],
    error = "";
  try {
    configs = gridConfigs(base, axes);
  } catch (caught) {
    error = caught instanceof Error ? caught.message : String(caught);
  }
  const patch = (index: number, value: Partial<GridAxis>) =>
    setAxes((current) => current.map((axis, i) => (i === index ? { ...axis, ...value } : axis)));
  return (
    <Dialog open={open} onClose={onClose} title="参数实验" className="research-grid-dialog">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!error && !busy) onRun(configs, structuredClone(axes));
        }}
      >
        <div className="research-grid-intro">
          <span className="research-eyebrow">比较参数的影响</span>
          <p>选定要变化的参数，为每个参数填写候选值。其余设置沿用当前草稿。</p>
          <span>{source}</span>
        </div>
        <div className="research-grid-axis-head" aria-hidden="true">
          <span>参数</span>
          <span>候选值</span>
        </div>
        <div className="research-grid-axes">
          {axes.map((axis, index) => (
            <div className="research-grid-axis" key={index}>
              <label>
                <span className="sr-only">实验参数 {index + 1}</span>
                <Select
                  aria-label={`实验参数 ${index + 1}`}
                  value={axis.field}
                  disabled={busy}
                  onChange={(event) =>
                    patch(index, { field: event.currentTarget.value as GridField })
                  }
                >
                  {Object.entries(GRID_FIELDS).map(([field, meta]) => (
                    <option
                      key={field}
                      value={field}
                      disabled={axes.some((other, i) => i !== index && other.field === field)}
                    >
                      {meta.label}
                    </option>
                  ))}
                </Select>
              </label>
              <label className="research-grid-values">
                <span className="sr-only">{GRID_FIELDS[axis.field].label}候选值</span>
                <Input
                  aria-label={`${GRID_FIELDS[axis.field].label}候选值`}
                  aria-describedby={id}
                  value={axis.values}
                  maxLength={400}
                  disabled={busy}
                  onChange={(event) => patch(index, { values: event.currentTarget.value })}
                />
                <span>{GRID_FIELDS[axis.field].unit}</span>
              </label>
              <IconButton
                type="button"
                variant="ghost"
                size="sm"
                label={`移除实验参数 ${index + 1}`}
                disabled={busy || axes.length === 1}
                onClick={() => setAxes((current) => current.filter((_, i) => i !== index))}
              >
                <Trash2 size={15} />
              </IconButton>
            </div>
          ))}
        </div>
        <div className="research-grid-form-bottom">
          <Button
            type="button"
            variant="ghost"
            disabled={busy || axes.length >= 6}
            onClick={() => {
              const field = (Object.keys(GRID_FIELDS) as GridField[]).find(
                (field) => !axes.some((axis) => axis.field === field),
              );
              if (field)
                setAxes((current) => [
                  ...current,
                  {
                    field,
                    values: String(
                      Number((gridValue(base, field) * GRID_FIELDS[field].scale).toFixed(8)),
                    ),
                  },
                ]);
            }}
          >
            <Plus size={15} />
            添加参数
          </Button>
          <p id={id}>
            逗号分隔，如 6, 10, 14。止损等比例使用百分数，0 表示关闭。最多 {MAX_GRID_CONFIGS} 组。
          </p>
        </div>
        {error && (
          <p className="research-field-error" role="alert">
            {error}
          </p>
        )}
        <div className="research-grid-submit">
          <span>
            <b>{configs.length || "—"}</b> 个参数组合
          </span>
          <Button type="submit" variant="primary" disabled={busy || !!error}>
            <FlaskConical size={16} />
            运行参数实验
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

export function GridResults({
  grid,
  busy,
  expanded,
  onExpand,
  onView,
  onUse,
  onForget,
}: {
  grid: SelectedGrid;
  busy: boolean;
  expanded: boolean;
  onExpand: () => void;
  onView: (index: number) => void;
  onUse: (config: JsgConfig) => void;
  onForget: () => void;
}) {
  const [sort, setSort] = useState<{ metric: GridMetric; descending: boolean }>({
    metric: "totalReturn",
    descending: true,
  });
  const [page, setPage] = useState(0);
  const sorted = rankGrid(grid.result, sort.metric, sort.descending);
  const rows = sorted.slice(page * 20, page * 20 + 20);
  const changeSort = (metric: GridMetric) => {
    setSort((current) => ({
      metric,
      descending: current.metric === metric ? !current.descending : metric !== "fees",
    }));
    setPage(0);
  };
  const exportGrid = () => {
    const url = URL.createObjectURL(
      new Blob(
        [
          JSON.stringify({
            experiment: grid.run,
            manifest: grid.dataset.manifest,
            result: grid.result,
          }),
        ],
        { type: "application/json" },
      ),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "jsg-experiment.json";
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <section className="research-grid-results" aria-label="参数实验结果" data-grid-id={grid.run.id}>
      <div className="research-grid-result-head">
        <Button
          variant="ghost"
          className="research-grid-toggle"
          aria-expanded={expanded}
          onClick={onExpand}
        >
          <FlaskConical size={17} />
          <span>
            参数实验 <b>{grid.result.results.length}</b> 组
          </span>
          {expanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
        </Button>
        <div>
          <Button variant="ghost" size="sm" aria-label="导出参数实验" onClick={exportGrid}>
            <Download size={15} />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            aria-label="移除参数实验"
            disabled={busy}
            onClick={onForget}
          >
            <Trash2 size={15} />
          </Button>
        </div>
      </div>
      <p className="research-grid-meta">
        {dateText(grid.run.startDate)} — {dateText(grid.run.endDate)} · {grid.run.name}
        {grid.run.cached ? " · 已复用" : ""}
      </p>
      {expanded && (
        <>
          <SensitivityMap grid={grid} onView={onView} busy={busy} />
          <div className="research-grid-table-wrap">
            <table className="research-grid-table">
              <thead>
                <tr>
                  <th scope="col">组合</th>
                  {grid.run.axes.map((axis) => (
                    <th scope="col" key={axis.field}>
                      {GRID_FIELDS[axis.field]?.label ?? axis.field}
                    </th>
                  ))}
                  {(
                    [
                      ["totalReturn", "收益"],
                      ["maxDrawdown", "回撤"],
                      ["sharpe", "Sharpe"],
                      ["fees", "费用"],
                    ] as const
                  ).map(([metric, label]) => (
                    <th
                      key={metric}
                      scope="col"
                      aria-sort={
                        sort.metric === metric
                          ? sort.descending
                            ? "descending"
                            : "ascending"
                          : "none"
                      }
                    >
                      <button onClick={() => changeSort(metric)} aria-label={`按${label}排序`}>
                        {label}
                        {sort.metric === metric &&
                          (sort.descending ? <ChevronDown size={12} /> : <ChevronUp size={12} />)}
                      </button>
                    </th>
                  ))}
                  <th scope="col">操作</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.index}>
                    <td>{String(row.index + 1).padStart(2, "0")}</td>
                    {grid.run.axes.map((axis) => (
                      <td key={axis.field}>
                        {Number(
                          (
                            gridValue(row.config, axis.field) *
                            (GRID_FIELDS[axis.field]?.scale ?? 1)
                          ).toFixed(8),
                        )}
                        <small>{GRID_FIELDS[axis.field]?.unit}</small>
                      </td>
                    ))}
                    <td data-tone={row.metrics.totalReturn >= 0 ? "positive" : "negative"}>
                      {percent(row.metrics.totalReturn)}
                    </td>
                    <td>{percent(row.metrics.maxDrawdown)}</td>
                    <td>{row.metrics.sharpe.toFixed(2)}</td>
                    <td>¥{money(row.metrics.fees)}</td>
                    <td className="research-grid-row-actions">
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={busy}
                        aria-label={`查看组合 ${row.index + 1} 详情`}
                        onClick={() => onView(row.index)}
                      >
                        查看详情
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={busy}
                        aria-label={`使用组合 ${row.index + 1} 参数`}
                        onClick={() => onUse(row.config)}
                      >
                        使用参数
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="research-grid-pagination">
            <span role="status">
              共 {sorted.length} 组 · {page * 20 + 1}–{Math.min(sorted.length, (page + 1) * 20)}
            </span>
            <div>
              <Button
                size="sm"
                variant="ghost"
                aria-label="上一页参数组合"
                disabled={page === 0}
                onClick={() => setPage((page) => page - 1)}
              >
                上一页
              </Button>
              <Button
                size="sm"
                variant="ghost"
                aria-label="下一页参数组合"
                disabled={(page + 1) * 20 >= sorted.length}
                onClick={() => setPage((page) => page + 1)}
              >
                下一页
              </Button>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
