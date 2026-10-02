import { benchmarkBaseline } from "@bcr/market-data/research/benchmark";
import { withResearchFiles } from "@bcr/market-data/research/file-lease";
import { dateText } from "@bcr/market-data/research/model";
import { Button, Spinner } from "@bcr/react";
import { useEffect, useState } from "react";
import { datasetKey } from "../session/config";
import { type SelectedRun } from "../session/model";
import { queryEvaluation } from "./client";
import { COMPARISON_COLORS, parameterDifferences } from "./comparison";
import type { ReturnStats } from "./evaluation";
import { money, percent } from "./format";
import { csvCell, downloadText } from "./report";

const ratio = (v: number | null) => (v === null ? "—" : v.toFixed(2));
const METRICS: { label: string; value: (s: ReturnStats) => string }[] = [
  { label: "总收益", value: (s) => percent(s.totalReturn) },
  { label: "年化收益", value: (s) => percent(s.annualizedReturn) },
  { label: "最大回撤", value: (s) => percent(s.maxDrawdown) },
  { label: "Sharpe", value: (s) => ratio(s.sharpe) },
  { label: "Sortino", value: (s) => ratio(s.sortino) },
  { label: "Calmar", value: (s) => ratio(s.calmar) },
  { label: "年化波动", value: (s) => percent(s.volatility) },
  { label: "年化下行波动", value: (s) => percent(s.downsideDeviation) },
  { label: "盈利日比例", value: (s) => percent(s.winRate) },
  { label: "日盈亏比", value: (s) => ratio(s.profitFactor) },
  { label: "平均盈利日 / 元", value: (s) => money(s.avgWin) },
  { label: "平均亏损日 / 元", value: (s) => money(s.avgLoss) },
];
export function ComparisonPanel({
  selected,
  comparisons,
}: {
  selected: SelectedRun;
  comparisons: SelectedRun[];
}) {
  const [stats, setStats] = useState<ReturnStats[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const abort = new AbortController();
    setStats(null);
    setError(null);
    void withResearchFiles("shared", async () => {
      const readings = await Promise.allSettled(
        [selected, ...comparisons].map(async (item) => {
          abort.signal.throwIfAborted();
          const manifest = {
            ...item.dataset.manifest,
            startDate: item.run.startDate,
            endDate: item.run.endDate,
          };
          const evaluation = await queryEvaluation(
            item.result,
            item.run.config.initialCapital,
            manifest.calendar
              .filter((s) => s.date >= manifest.startDate && s.date <= manifest.endDate)
              .map((s) => dateText(s.date)),
            benchmarkBaseline(manifest),
            undefined,
            abort.signal,
          );
          return evaluation.strategy;
        }),
      );
      return readings.map((reading) => {
        if (reading.status === "rejected") throw reading.reason;
        return reading.value;
      });
    })
      .then((value) => {
        if (!abort.signal.aborted) setStats(value);
      })
      .catch((caught: unknown) => {
        if (!abort.signal.aborted)
          setError(caught instanceof Error ? caught.message : String(caught));
      });
    return () => abort.abort();
  }, [selected, comparisons]);
  const runs = [selected, ...comparisons];
  const names = runs.map((_, i) => (i === 0 ? "本次运行" : `对照 ${i}`));
  const differences = parameterDifferences(runs.map((r) => r.run));
  const rows = stats ? METRICS.map((m) => [m.label, ...stats.map(m.value)]) : [];
  const header = (
    <thead>
      <tr>
        <th>指标 / 参数</th>
        {names.map((name, i) => (
          <th key={name} className="numeric">
            <span
              className="research-comparison-name"
              style={{ color: `var(--color-${i === 0 ? "accent" : COMPARISON_COLORS[i - 1]})` }}
            >
              {name}
            </span>
            <small>
              {new Date(runs[i]!.run.createdAt).toLocaleString("zh-CN", {
                month: "2-digit",
                day: "2-digit",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </small>
          </th>
        ))}
      </tr>
    </thead>
  );
  return (
    <section className="research-comparison" aria-label="多运行比较">
      <div className="research-comparison-heading">
        <h3>
          运行比较 <span>{runs.length} 次</span>
        </h3>
        <Button
          variant="ghost"
          size="sm"
          disabled={!stats}
          onClick={() =>
            downloadText(
              "\uFEFF" +
                [
                  ["指标 / 参数", ...names],
                  ["运行 ID", ...runs.map((r) => r.run.id)],
                  ...rows,
                  ...differences.map((d) => [d.label, ...d.values]),
                ]
                  .map((row) => row.map(csvCell).join(","))
                  .join("\r\n"),
              "jsg-comparison.csv",
              "text/csv;charset=utf-8",
            )
          }
        >
          导出比较
        </Button>
      </div>
      <p>相同回测区间 · 净值按各自本金归一化 · 指标使用完整日收益</p>
      {comparisons.some((r) => datasetKey(r.run.dataset) !== datasetKey(selected.run.dataset)) && (
        <p className="research-warning">部分运行的数据快照不同，差异也可能来自数据变化。</p>
      )}
      {comparisons.some((r) => r.run.versions?.engine !== selected.run.versions?.engine) && (
        <p className="research-warning">部分运行使用不同版本的回测引擎。</p>
      )}
      {error ? (
        <p className="research-error" role="alert">
          比较读取失败：{error}
        </p>
      ) : stats ? (
        <div className="research-table-wrap">
          <table className="research-table">
            {header}
            <tbody>
              {rows.map(([label, ...values]) => (
                <tr key={label}>
                  <th scope="row">{label}</th>
                  {values.map((v, i) => (
                    <td key={names[i]} className="numeric">
                      {v}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p role="status">
          <Spinner size="sm" /> 正在计算比较指标…
        </p>
      )}
      <details className="research-comparison-parameters">
        <summary>参数差异 · {differences.length} 项</summary>
        {differences.length ? (
          <div className="research-table-wrap">
            <table className="research-table">
              {header}
              <tbody>
                {differences.map((d) => (
                  <tr key={d.key}>
                    <th scope="row">{d.label}</th>
                    {d.values.map((v, i) => (
                      <td key={names[i]} className="numeric">
                        {v}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p>各次运行的策略参数相同。</p>
        )}
      </details>
    </section>
  );
}
