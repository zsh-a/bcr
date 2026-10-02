import type { RuntimeServices } from "@bcr/core";
import { dateText, type ResearchDataset } from "@bcr/market-data/research/model";
import { strategySpec, type JsgConfig } from "@bcr/quant-core";
import { Button, Dialog, Input, Select } from "@bcr/react";
import { ChevronDown, ChevronUp, Download, FlaskConical, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { money, percent } from "../results/format";
import { downloadText } from "../results/report";
import type { SelectedStudy } from "../session/model";
import { costStress, validationPlan, type ValidationRequest } from "./validation";
import { WalkForwardPanel } from "./WalkForwardPanel";

export function ValidationSettings({
  open,
  onClose,
  base,
  dataset,
  busy,
  onRun,
}: {
  open: boolean;
  onClose: () => void;
  base: JsgConfig;
  dataset: ResearchDataset | null;
  busy: boolean;
  onRun: (request: ValidationRequest) => void;
}) {
  const [mode, setMode] = useState<ValidationRequest["mode"]>("walk-forward"),
    [objective, setObjective] = useState<ValidationRequest["objective"]>("sharpe");
  const [stocks, setStocks] = useState(`${Math.max(1, base.stockCount - 4)}, ${base.stockCount}`),
    [stops, setStops] = useState("0, 5"),
    [lookbacks, setLookbacks] = useState(String(strategySpec(base).lookback));
  const [trainPercent, setTrainPercent] = useState(70),
    [trainDays, setTrainDays] = useState(60),
    [testDays, setTestDays] = useState(20);
  const defaultPeriod = String(strategySpec(base).lookback);
  const previousPeriod = useRef(defaultPeriod);
  useEffect(() => {
    const previous = previousPeriod.current;
    setLookbacks((value) => (value === previous ? defaultPeriod : value));
    previousPeriod.current = defaultPeriod;
  }, [defaultPeriod]);
  const request: ValidationRequest = {
    mode,
    objective,
    trainPercent,
    trainDays,
    testDays,
    axes: [
      { field: "stockCount", values: stocks },
      { field: "stopLoss", values: stops },
      { field: "strategyLookback", values: lookbacks },
    ],
  };
  let error = "",
    count = 0,
    folds = 0;
  try {
    if (!dataset) throw new Error("请先获取或导入数据快照");
    const plan = validationPlan(dataset.manifest, base, request);
    costStress(base);
    count = plan.training.length;
    folds = plan.folds.length;
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }
  return (
    <Dialog open={open} onClose={onClose} title="稳健性验证" className="research-grid-dialog">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!busy && !error) onRun(structuredClone(request));
        }}
      >
        <p className="research-dialog-lead">
          使用已冻结快照：{dataset?.manifest.name ?? "未选择"}
          {dataset &&
            ` · ${dateText(dataset.manifest.startDate)} — ${dateText(dataset.manifest.endDate)}`}
          。变更数据源后请先获取新快照。
        </p>
        <div className="research-validation-fields">
          <label>
            验证方式
            <Select
              aria-label="验证方式"
              value={mode}
              onChange={(e) => setMode(e.target.value as ValidationRequest["mode"])}
            >
              <option value="walk-forward">连续样本外 · 滚动选参</option>
              <option value="holdout">时间顺序 · 样本外验证</option>
              <option value="rolling">滚动训练与验证</option>
              <option value="cost">仅成本压力</option>
            </Select>
          </label>
          {mode !== "cost" && (
            <>
              <label>
                训练选择指标
                <Select
                  aria-label="训练选择指标"
                  value={objective}
                  onChange={(e) => setObjective(e.target.value as ValidationRequest["objective"])}
                >
                  <option value="sharpe">Sharpe</option>
                  <option value="totalReturn">总收益</option>
                </Select>
              </label>
              <label>
                目标股票数候选
                <Input
                  aria-label="验证股票数候选"
                  value={stocks}
                  onChange={(e) => setStocks(e.target.value)}
                  maxLength={400}
                />
              </label>
              <label>
                止损候选（%）
                <Input
                  aria-label="验证止损候选"
                  value={stops}
                  onChange={(e) => setStops(e.target.value)}
                  maxLength={400}
                />
              </label>
              <label>
                观察周期候选
                <Input
                  aria-label="验证观察周期候选"
                  value={lookbacks}
                  onChange={(e) => setLookbacks(e.target.value)}
                  maxLength={400}
                />
              </label>
            </>
          )}
          {mode === "holdout" && (
            <label>
              训练占比（%）
              <Input
                aria-label="训练占比"
                type="number"
                min={10}
                max={90}
                value={trainPercent}
                onChange={(e) => setTrainPercent(Number(e.target.value))}
              />
            </label>
          )}
          {(mode === "rolling" || mode === "walk-forward") && (
            <>
              <label>
                训练窗口（交易日）
                <Input
                  aria-label="训练窗口"
                  type="number"
                  min={20}
                  value={trainDays}
                  onChange={(e) => setTrainDays(Number(e.target.value))}
                />
              </label>
              <label>
                测试窗口（交易日）
                <Input
                  aria-label="测试窗口"
                  type="number"
                  min={5}
                  value={testDays}
                  onChange={(e) => setTestDays(Number(e.target.value))}
                />
              </label>
            </>
          )}
        </div>
        <p className="research-help">
          {mode === "walk-forward"
            ? "仅用此前训练数据选参，在训练末日收盘生成订单，下一交易日执行。测试期间延续账户、持仓和风控状态，包含最后一个不足完整长度的窗口。"
            : "只用训练窗口选参数，再回放紧随其后的测试窗口。各窗口从相同本金空仓开始，价格预热沿用此前历史；滚动测试仅保留完整窗口。"}
        </p>
        <p className="research-help">
          同时对当前草稿的佣金、滑点及分期最低佣金、过户费、卖出税测试 0.5 / 1 / 2 / 3 倍成本。
        </p>
        {error && (
          <p role="alert" className="research-field-error">
            {error}
          </p>
        )}
        <div className="research-grid-submit">
          <span>
            {folds} 个窗口 · {count} 组训练
          </span>
          <Button type="submit" variant="primary" disabled={busy || !!error}>
            <FlaskConical size={15} />
            运行稳健性验证
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
export function ValidationResults({
  services,
  onWorking,
  study,
  expanded,
  onExpand,
  onForget,
  busy,
}: {
  services: RuntimeServices;
  onWorking: (value: boolean) => void;
  study: SelectedStudy;
  expanded: boolean;
  onExpand: () => void;
  onForget: () => void;
  busy: boolean;
}) {
  const { result, run } = study;
  return (
    <section className="research-grid-results" aria-label="稳健性验证结果" data-study-id={run.id}>
      <div className="research-grid-result-head">
        <Button
          variant="ghost"
          className="research-grid-toggle"
          aria-expanded={expanded}
          onClick={onExpand}
        >
          <FlaskConical size={17} />
          <span>
            稳健性验证 ·{" "}
            {result.request.mode === "walk-forward"
              ? "连续样本外"
              : result.request.mode === "rolling"
                ? "滚动"
                : result.request.mode === "holdout"
                  ? "样本外"
                  : "成本压力"}
          </span>
          {expanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
        </Button>
        <div>
          <Button
            variant="ghost"
            size="sm"
            aria-label="导出稳健性验证"
            onClick={() =>
              downloadText(
                JSON.stringify({ run, manifest: study.dataset.manifest, result }, null, 2),
                "jsg-validation.json",
                "application/json",
              )
            }
          >
            <Download size={15} />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={busy}
            aria-label="移除稳健性验证"
            onClick={onForget}
          >
            <Trash2 size={15} />
          </Button>
        </div>
      </div>
      <p className="research-grid-meta">
        {run.name} · {dateText(run.startDate)} — {dateText(run.endDate)} · 冻结数据
      </p>
      {expanded && (
        <div className="research-insights">
          {result.continuous && (
            <WalkForwardPanel services={services} study={study} busy={busy} onWorking={onWorking} />
          )}
          {result.folds.length > 0 && !result.continuous && (
            <>
              <h3>
                样本外表现 · 训练按 {result.request.objective === "sharpe" ? "Sharpe" : "总收益"}{" "}
                选择
              </h3>
              <div className="research-insights-scroll">
                <table className="research-table">
                  <thead>
                    <tr>
                      <th>训练 → 测试</th>
                      <th>选定参数</th>
                      <th className="numeric">训练收益 / Sharpe</th>
                      <th className="numeric">测试收益 / Sharpe</th>
                      <th className="numeric">测试回撤</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.folds.map((f, i) => (
                      <tr key={i}>
                        <td>
                          {dateText(f.train.start)} — {dateText(f.train.end)}
                          <small className="research-cell-note">
                            {dateText(f.test.start)} — {dateText(f.test.end)}
                          </small>
                        </td>
                        <td>
                          {f.config.stockCount} 只 · 止损 {percent(f.config.stopLoss)}
                        </td>
                        <td className="numeric">
                          {percent(f.trainMetrics.totalReturn)} / {f.trainMetrics.sharpe.toFixed(2)}
                        </td>
                        <td className="numeric">
                          {percent(f.testMetrics.totalReturn)} / {f.testMetrics.sharpe.toFixed(2)}
                        </td>
                        <td className="numeric">{percent(f.testMetrics.maxDrawdown)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="research-help">
                每个训练与测试窗口独立重置账户。测试表现用于检验此前选出的参数；各窗口收益未拼接为连续组合净值。
              </p>
            </>
          )}
          <details className="research-study-costs" open={!result.continuous}>
            <summary>成本压力 · 验证提交时的固定参数</summary>
            <div className="research-insights-scroll">
              <table className="research-table">
                <thead>
                  <tr>
                    <th>成本倍数</th>
                    <th className="numeric">收益</th>
                    <th className="numeric">Sharpe</th>
                    <th className="numeric">回撤</th>
                    <th className="numeric">实际费用</th>
                  </tr>
                </thead>
                <tbody>
                  {result.costs.map((c) => (
                    <tr key={c.multiplier}>
                      <td>
                        {c.multiplier} ×{c.multiplier === 1 ? " · 基准" : ""}
                      </td>
                      <td className="numeric">{percent(c.metrics.totalReturn)}</td>
                      <td className="numeric">{c.metrics.sharpe.toFixed(2)}</td>
                      <td className="numeric">{percent(c.metrics.maxDrawdown)}</td>
                      <td className="numeric">¥{money(c.metrics.fees)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="research-help">
              成本改变可能影响可买数量和后续订单，收益差值包含这些路径变化。完整训练候选、费用表、选择口径和源快照引用随验证结果导出。
            </p>
          </details>
        </div>
      )}
    </section>
  );
}
