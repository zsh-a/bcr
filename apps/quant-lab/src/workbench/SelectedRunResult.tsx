import { dateText } from "@bcr/market-data/research/model";
import { STRATEGIES, strategySpec } from "@bcr/quant-core";
import { Button, Spinner, useRuntime } from "@bcr/react";
import { History } from "lucide-react";
import { NamesProvider, NamesStatus, useResearchNames } from "../data/ResearchNames";
import { compatibleRun } from "../results/comparison";
import { compactMoney, percent, timeLabel } from "../results/format";
import { Quality } from "../results/Quality";
import { ResultExplorer } from "../results/ResultExplorer";
import { type SelectedRun } from "../session/model";
import type { ResearchController } from "../session/service";
import { ResearchContext } from "./ResearchContext";
import type { RunComparisons } from "./useRunComparisons";

export function SelectedRunResult({
  research,
  selected,
  names,
  connection,
  comparison,
  busy,
  onHistory,
  onComparison,
  onDataSettings,
  onWorking,
}: {
  research: ResearchController;
  selected: SelectedRun;
  names: ReturnType<typeof useResearchNames>;
  connection: NonNullable<Parameters<typeof useResearchNames>[2]>;
  comparison: RunComparisons;
  busy: boolean;
  onHistory: () => void;
  onComparison: () => void;
  onDataSettings: () => void;
  onWorking: (busy: boolean) => void;
}) {
  const services = useRuntime();
  const { state } = research;
  const experiment = state.experiments.find((e) => e.id === state.experimentId)!;
  const baselineId = experiment.baselineId;
  const { comparisons, comparing, compare } = comparison;
  return (
    <div
      className="research-run-result"
      data-run-id={selected.run.id}
      hidden={state.view !== "run"}
    >
      <div className="research-result-heading">
        <div>
          <button
            className="research-run-selector"
            aria-label="选择历史运行"
            onClick={() => onHistory()}
          >
            运行{" "}
            {String(state.runs.findIndex((run) => run.id === selected.run.id) + 1).padStart(2, "0")}{" "}
            <History size={13} />
          </button>
          <p>
            <span role="heading" aria-level={2}>
              {STRATEGIES[strategySpec(selected.run.config).id].title}
            </span>
            {dateText(selected.run.startDate)} — {dateText(selected.run.endDate)}
            <span>
              {selected.run.config.stockCount} 只 ·{" "}
              {compactMoney(selected.run.config.initialCapital)}
            </span>
            {selected.dataset.snapshot && (
              <span
                title={`获取于 ${selected.dataset.snapshot.createdAt}；源覆盖至 ${selected.dataset.snapshot.sourceLastDate ?? dateText(selected.run.endDate)}`}
              >
                {timeLabel(selected.run.createdAt)} ·{" "}
                {selected.run.cached
                  ? "缓存"
                  : `${((selected.run.durationMs ?? 0) / 1000).toFixed(2)} 秒`}
              </span>
            )}
          </p>
        </div>
        <div className="research-result-context">
          <Quality
            manifest={selected.dataset.manifest}
            result={selected.result}
            snapshot={selected.dataset.snapshot}
          />
          {research.selecting && <Spinner size="sm" />}
          {baselineId &&
            baselineId !== selected.run.id &&
            state.runs.some((r) => r.id === baselineId && compatibleRun(selected.run, r)) && (
              <Button
                variant="ghost"
                size="sm"
                disabled={comparing}
                onClick={() => {
                  if (!comparisons.some((r) => r.run.id === baselineId)) void compare(baselineId);
                  else onComparison();
                }}
              >
                对比基线
              </Button>
            )}
          <Button
            variant="ghost"
            size="sm"
            aria-label={comparisons.length ? `管理对照（${comparisons.length}）` : "添加对照"}
            onClick={() => onComparison()}
          >
            {comparisons.length ? `对照 ${comparisons.length}` : "添加对照"}
          </Button>
        </div>
      </div>
      <ResearchContext
        recorded
        dataset={selected.dataset}
        config={selected.run.config}
        versions={selected.run.versions}
        nextDataset={state.dataset}
      />
      <dl className="research-metrics" aria-label="所选运行核心指标">
        {[
          [
            "总收益",
            percent(selected.result.metrics.totalReturn),
            selected.result.metrics.totalReturn >= 0 ? "positive" : "negative",
          ],
          ["年化收益", percent(selected.result.metrics.annualizedReturn), "neutral"],
          ["最大回撤", percent(selected.result.metrics.maxDrawdown), "neutral"],
          ["Sharpe", selected.result.metrics.sharpe.toFixed(2), "neutral"],
        ].map(([label, value, tone]) => (
          <div key={label} data-tone={tone}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      <NamesProvider names={names.names}>
        <ResultExplorer
          services={services}
          selected={selected}
          comparisons={comparisons}
          connection={connection}
          busy={busy}
          onBenchmark={research.attachBenchmark}
          onWorking={onWorking}
        />
      </NamesProvider>
      <NamesStatus metadata={names} onSettings={() => onDataSettings()} />
    </div>
  );
}
