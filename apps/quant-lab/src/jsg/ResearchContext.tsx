import { Check, ChevronDown, Database, Info } from "lucide-react";
import { STRATEGIES, type JsgConfig, type ResearchDataset } from "./model";
import { researchContext, snapshotDifference } from "./context";
import { datasetKey } from "./session";
import type { ReplayVersions } from "./versions";

export function ResearchContext({
  dataset,
  config,
  versions,
  nextDataset,
  recorded = false,
}: {
  dataset: ResearchDataset;
  config: JsgConfig;
  versions?: ReplayVersions | undefined;
  nextDataset?: ResearchDataset | null;
  recorded?: boolean;
}) {
  const context = researchContext(dataset, config);
  const diff =
    nextDataset && datasetKey(dataset) !== datasetKey(nextDataset)
      ? snapshotDifference(dataset, nextDataset)
      : null;
  return (
    <details className="research-context">
      <summary>
        <Database size={14} />
        <span>数据与执行</span>
        <small>
          {context.raw ? "原始价格" : "复权研究"} ·{" "}
          {context.raw || config.tPlusOne ? "T+1" : "当日可卖"}
        </small>
        <ChevronDown size={14} />
      </summary>
      <div className="research-context-body">
        <div>
          <h3>冻结数据</h3>
          <dl className="research-context-facts">
            {context.rows.map((row) => (
              <div key={row.label}>
                <dt>{row.label}</dt>
                <dd>
                  {row.ready ? <Check size={12} /> : <Info size={12} />}
                  {row.value}
                </dd>
              </div>
            ))}
          </dl>
        </div>
        <div>
          <h3>本次成交规则</h3>
          <dl className="research-context-facts">
            {context.execution.map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
        </div>
        <p className="research-help">
          {STRATEGIES[context.spec.id].title} ·{" "}
          {versions?.strategy ??
            (recorded ? "策略版本未记录" : STRATEGIES[context.spec.id].version)}{" "}
          · 观察 {context.spec.lookback} 次行情 · {versions?.engine ?? "引擎版本未记录"}
          <br />
          快照 <code title={context.snapshot}>{context.snapshot.slice(0, 16)}</code> ·
          历史能力按快照声明展示。预热交易日充足不代表每只证券都有足够行情观测。
        </p>
        {diff && (
          <div className="research-snapshot-diff" aria-label="快照变化">
            <h3>下一次数据相对本次</h3>
            <p>
              新增 {diff.addedDates} 日{diff.addedRange ? `（${diff.addedRange}）` : ""} · 移除{" "}
              {diff.removedDates} 日 · 新增 / 移除证券 {diff.addedSymbols} / {diff.removedSymbols} ·
              不同指纹分片 {diff.differentPartitions}
            </p>
            <small>分片指纹变化也可能来自区间或分片边界调整，不能直接认定历史行情被修订。</small>
          </div>
        )}
      </div>
    </details>
  );
}
