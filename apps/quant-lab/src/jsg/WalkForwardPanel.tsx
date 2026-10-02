import { lazy, Suspense, useMemo, useState } from "react";
import { Button, Select, Spinner } from "@bcr/react";
import type { RuntimeServices } from "@bcr/core";
import { Download } from "lucide-react";
import type { SelectedRun, SelectedStudy } from "./session";
import { dateText } from "./model";
import { GRID_FIELDS, gridValue } from "./grid";
import { money, percent } from "./Orders";
import { ResearchTabs } from "./ResearchTabs";
import { ResearchContext } from "./ResearchContext";
import { exportResearchResult } from "./data";
import { withResearchFiles } from "./file-lease";
const ResearchChart = lazy(() => import("./ResearchChart"));
const NO_COMPARISONS: SelectedRun[] = [];

export function WalkForwardPanel({
  services,
  study,
  busy,
  onWorking,
}: {
  services: RuntimeServices;
  study: SelectedStudy;
  busy: boolean;
  onWorking: (value: boolean) => void;
}) {
  const c = study.result.continuous!;
  const [tab, setTab] = useState<"curve" | "periods" | "windows" | "parameters">("curve");
  const [period, setPeriod] = useState("months"),
    [page, setPage] = useState(0);
  const [exporting, setExporting] = useState(false),
    [error, setError] = useState<string | null>(null);
  const selected: SelectedRun = useMemo(
    () => ({
      dataset: study.dataset,
      result: c.result,
      run: {
        ...study.run,
        config: c.config,
        parameterSchedule: c.schedule,
        resultRef: c.resultRef,
        metrics: c.result.metrics,
        startDate: c.config.researchWindow!.start,
        endDate: c.config.researchWindow!.end,
      },
    }),
    [study, c],
  );
  const exportFull = async () => {
    if (busy || exporting) return;
    setExporting(true);
    onWorking(true);
    setError(null);
    try {
      const output = await withResearchFiles("shared", () =>
        exportResearchResult(
          services,
          c.config,
          study.dataset.manifest,
          c.result,
          study.dataset.snapshot,
          selected.run,
        ),
      );
      const url = URL.createObjectURL(output.blob),
        anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "quant-walk-forward.json";
      anchor.click();
      setTimeout(() => {
        URL.revokeObjectURL(url);
        void output.cleanup().catch(() => undefined);
      }, 60_000);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setExporting(false);
      onWorking(false);
    }
  };
  const rows = c.evaluation[period === "months" ? "months" : "years"];
  const metrics = c.result.metrics;
  return (
    <section className="research-walk-forward" aria-label="连续样本外表现">
      <div className="research-walk-forward-heading">
        <div>
          <h3>连续样本外</h3>
          <p>
            {c.evaluation.first} — {c.evaluation.last} · {metrics.days} 个交易日 ·{" "}
            {c.schedule.length} 段参数
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          disabled={busy || exporting}
          aria-label="导出连续回测完整结果"
          onClick={() => void exportFull()}
        >
          {exporting ? <Spinner size="sm" /> : <Download size={14} />}完整结果
        </Button>
      </div>
      <dl className="research-metrics" aria-label="连续样本外指标">
        {[
          ["总收益", percent(metrics.totalReturn)],
          ["最大回撤", percent(metrics.maxDrawdown)],
          ["Sharpe", metrics.sharpe.toFixed(2)],
          ["期末资产", `¥${money(metrics.finalEquity)}`],
        ].map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      <ResearchContext
        dataset={study.dataset}
        config={c.config}
        versions={study.run.versions}
        recorded
      />
      <ResearchTabs
        tabs={[
          { value: "curve", label: "净值" },
          { value: "periods", label: "分期收益" },
          { value: "windows", label: "验证窗口", count: c.schedule.length },
          { value: "parameters", label: "参数稳定性" },
        ]}
        value={tab}
        onChange={setTab}
        label="连续验证分析"
      >
        {tab === "curve" && (
          <Suspense fallback={<Spinner size="sm" />}>
            <ResearchChart services={services} selected={selected} comparisons={NO_COMPARISONS} />
          </Suspense>
        )}
        {tab === "periods" && (
          <>
            <div className="research-insights-tools">
              <Select
                aria-label="样本外分期频率"
                value={period}
                onChange={(e) => {
                  setPeriod(e.target.value);
                  setPage(0);
                }}
              >
                <option value="months">月度</option>
                <option value="years">年度</option>
              </Select>
              <span className="research-help">按上一交易日资产复合计算</span>
            </div>
            <div className="research-insights-scroll">
              <table className="research-table">
                <thead>
                  <tr>
                    <th>期间</th>
                    <th>交易日</th>
                    <th className="numeric">收益</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(page * 24, (page + 1) * 24).map((r) => (
                    <tr key={r.period}>
                      <td>{r.period}</td>
                      <td>{r.days}</td>
                      <td className="numeric">{percent(r.strategy)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="research-pagination">
              <span>{rows.length} 个期间</span>
              <div>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={!page}
                  onClick={() => setPage((v) => v - 1)}
                >
                  上一页
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={(page + 1) * 24 >= rows.length}
                  onClick={() => setPage((v) => v + 1)}
                >
                  下一页
                </Button>
              </div>
            </div>
          </>
        )}
        {tab === "windows" && (
          <>
            <p className="research-help">连续收益包含延续持仓；独立测试从空仓起步，供对照使用。</p>
            <div className="research-insights-scroll">
              <table className="research-table research-deployed-folds">
                <thead>
                  <tr>
                    <th>训练 → 部署</th>
                    <th>选定参数</th>
                    <th className="numeric">训练 Sharpe</th>
                    <th className="numeric">连续收益</th>
                    <th className="numeric">独立测试收益</th>
                    <th className="numeric">段内回撤</th>
                    <th className="numeric">成交 / 费用</th>
                  </tr>
                </thead>
                <tbody>
                  {c.deployed.map((d, i) => {
                    const f = study.result.folds[i]!;
                    return (
                      <tr key={d.start}>
                        <td>
                          {dateText(f.train.start)} — {dateText(f.train.end)}
                          <small className="research-cell-note">
                            {dateText(d.start)} — {dateText(d.end)} · {d.days} 日
                          </small>
                        </td>
                        <td>
                          {study.result.request.axes
                            .map(
                              (a) =>
                                `${GRID_FIELDS[a.field].label} ${gridValue(f.config, a.field) * GRID_FIELDS[a.field].scale}${GRID_FIELDS[a.field].unit}`,
                            )
                            .join(" · ")}
                        </td>
                        <td className="numeric">{f.trainMetrics.sharpe.toFixed(2)}</td>
                        <td className="numeric">{percent(d.totalReturn)}</td>
                        <td className="numeric">{percent(f.testMetrics.totalReturn)}</td>
                        <td className="numeric">{percent(d.maxDrawdown)}</td>
                        <td className="numeric">
                          {d.filledOrders} / ¥{money(d.fees)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
        {tab === "parameters" && (
          <div className="research-parameter-stability">
            <div className="research-stability-summary">
              <strong>
                {c.stability.switches}
                <span> / {c.stability.transitions}</span>
              </strong>
              <p>相邻窗口的参数切换次数</p>
            </div>
            <div className="research-stability-axes">
              {c.stability.axes.map((axis) => (
                <div key={axis.field}>
                  <h4>{GRID_FIELDS[axis.field].label}</h4>
                  <div className="research-stability-values">
                    {axis.values.map((v) => (
                      <span key={v.value}>
                        <b>
                          {v.value * GRID_FIELDS[axis.field].scale}
                          {GRID_FIELDS[axis.field].unit}
                        </b>
                        <small>{v.folds} 个窗口</small>
                        <i style={{ width: `${(v.folds / c.schedule.length) * 100}%` }} />
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </ResearchTabs>
      <p className="research-help">
        仅使用每段之前的训练数据选参；在训练末日收盘生成订单，下一交易日执行。账户、公司行为和风控状态连续。净值从实际每日资产计算，包含最后一个不足完整长度的测试窗口。
      </p>
      {error && (
        <p role="alert" className="research-field-error">
          {error}
        </p>
      )}
    </section>
  );
}
