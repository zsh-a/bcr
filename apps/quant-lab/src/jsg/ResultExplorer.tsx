import { useEffect, useState } from "react";
import type { RuntimeServices } from "@bcr/core";
import { Button, Dialog, Input, Spinner } from "@bcr/react";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { Orders, money, percent } from "./Orders";
import { dateText, type JsgResult } from "./model";
import { datasetKey, type SelectedRun } from "./session";
import { queryDecision } from "./result-data";
import { ResearchTabs } from "./ResearchTabs";

function Holdings({ result }: { result: JsgResult }) {
  const [page, setPage] = useState(0);
  const [detail, setDetail] = useState<JsgResult["holdings"][number] | null>(null);
  return (
    <>
      <div className="research-table-wrap">
        <table className="research-table">
          <thead>
            <tr>
              <th>证券</th>
              <th className="numeric">数量</th>
              <th className="numeric">成本</th>
              <th className="numeric">期末价格</th>
              <th className="numeric">市值</th>
              <th className="numeric">仓位</th>
            </tr>
          </thead>
          <tbody>
            {result.holdings.slice(page * 50, (page + 1) * 50).map((holding) => (
              <tr key={holding.code}>
                <td>
                  <button className="research-table-link" onClick={() => setDetail(holding)}>
                    {holding.code}
                  </button>
                </td>
                <td className="numeric">{holding.quantity.toLocaleString()}</td>
                <td className="numeric">{money(holding.averageCost)}</td>
                <td className="numeric">{money(holding.price)}</td>
                <td className="numeric">{money(holding.value)}</td>
                <td className="numeric">{percent(holding.value / result.metrics.finalEquity)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {result.holdings.length === 0 && <p className="research-small-empty">期末没有持仓。</p>}
      </div>
      <div className="research-pagination">
        <span>期末持仓 · {result.holdings.length} 只</span>
        <div>
          <Button
            variant="ghost"
            size="sm"
            aria-label="上一页持仓"
            disabled={page === 0}
            onClick={() => setPage((p) => p - 1)}
          >
            <ArrowLeft size={14} />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            aria-label="下一页持仓"
            disabled={(page + 1) * 50 >= result.holdings.length}
            onClick={() => setPage((p) => p + 1)}
          >
            <ArrowRight size={14} />
          </Button>
        </div>
      </div>
      <Dialog
        open={detail !== null}
        onClose={() => setDetail(null)}
        title="期末持仓"
        placement="sheet"
        className="research-detail-dialog"
      >
        {detail && (
          <>
            <div className="research-detail-title">
              <b>{detail.code}</b>
            </div>
            <dl className="research-facts">
              {[
                ["持有数量", detail.quantity.toLocaleString()],
                ["平均成本", money(detail.averageCost)],
                ["期末价格", money(detail.price)],
                ["期末市值", `¥${money(detail.value)}`],
                ["仓位", percent(detail.value / result.metrics.finalEquity)],
              ].map(([label, value]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
          </>
        )}
      </Dialog>
    </>
  );
}
function Decisions({ services, selected }: { services: RuntimeServices; selected: SelectedRun }) {
  const dates = selected.dataset.manifest.calendar
    .filter((d) => d.rebalance && d.date >= selected.run.startDate)
    .map((d) => dateText(d.date));
  const [date, setDate] = useState(
    selected.result.decisions.at(-1)?.date ?? dates.at(-1) ?? dateText(selected.run.endDate),
  );
  const [value, setValue] = useState<JsgResult["decisions"][number] | undefined>(
    selected.result.decisions.at(-1),
  );
  const [loading, setLoading] = useState(false),
    [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  useEffect(() => {
    const abort = new AbortController();
    setLoading(true);
    setError(null);
    setPage(0);
    void queryDecision(services, selected.result, date, abort.signal)
      .then((decision) => {
        if (!abort.signal.aborted) {
          setValue(decision);
          setLoading(false);
        }
      })
      .catch((caught: unknown) => {
        if (!abort.signal.aborted) {
          setError(caught instanceof Error ? caught.message : String(caught));
          setLoading(false);
        }
      });
    return () => abort.abort();
  }, [services, selected.result, date]);
  const before = dates.findLast((d) => d < date),
    after = dates.find((d) => d > date);
  return (
    <div className="research-decisions">
      <div className="research-decision-toolbar">
        <label>
          调仓日期
          <Input
            type="date"
            aria-label="调仓日期"
            min={dateText(selected.run.startDate)}
            max={dateText(selected.run.endDate)}
            value={date}
            onChange={(event) => setDate(event.currentTarget.value)}
          />
        </label>
        <div>
          <Button
            variant="ghost"
            size="sm"
            disabled={!before || loading}
            aria-label="上一次调仓"
            onClick={() => before && setDate(before)}
          >
            <ArrowLeft size={14} />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={!after || loading}
            aria-label="下一次调仓"
            onClick={() => after && setDate(after)}
          >
            <ArrowRight size={14} />
          </Button>
        </div>
      </div>
      {error && (
        <p role="alert" className="research-error">
          {error}
        </p>
      )}
      {loading ? (
        <div className="research-small-empty">
          <Spinner size="sm" />
          读取调仓记录…
        </div>
      ) : value ? (
        <>
          <dl className="research-secondary-metrics">
            <div>
              <dt>领涨行业</dt>
              <dd>{value.topIndustry ?? "—"}</dd>
            </div>
            <div>
              <dt>行业宽度</dt>
              <dd>{percent(value.breadth)}</dd>
            </div>
            <div>
              <dt>目标证券</dt>
              <dd>{value.targets.length} 只</dd>
            </div>
          </dl>
          <p className="research-help">
            目标由该日收盘信号确定；实际成交请查看订单中的信号日期和撮合时点。
          </p>
          <div className="research-targets">
            {value.targets.slice(page * 50, (page + 1) * 50).map((code) => (
              <span key={code}>{code}</span>
            ))}
          </div>
          {value.targets.length > 50 && (
            <div className="research-pagination">
              <span>第 {page + 1} 页</span>
              <div>
                <Button size="sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
                  上一页
                </Button>
                <Button
                  size="sm"
                  disabled={(page + 1) * 50 >= value.targets.length}
                  onClick={() => setPage((p) => p + 1)}
                >
                  下一页
                </Button>
              </div>
            </div>
          )}
        </>
      ) : (
        <p className="research-small-empty">该日没有调仓信号。</p>
      )}
    </div>
  );
}
export function ResultExplorer({
  services,
  selected,
  comparison,
}: {
  services: RuntimeServices;
  selected: SelectedRun;
  comparison: SelectedRun | null;
}) {
  const [tab, setTab] = useState<"overview" | "orders" | "holdings" | "decisions">("overview");
  const metrics = selected.result.metrics;
  const cash = selected.result.equity.at(-1)?.cash ?? 0;
  return (
    <div className="research-explorer">
      <ResearchTabs
        label="回测结果"
        value={tab}
        onChange={setTab}
        tabs={[
          { value: "overview", label: "概览" },
          { value: "orders", label: "成交", count: metrics.filledOrders + metrics.rejectedOrders },
          { value: "holdings", label: "持仓", count: selected.result.holdings.length },
          { value: "decisions", label: "调仓" },
        ]}
      >
        {tab === "overview" && (
          <>
            <dl className="research-secondary-metrics">
              {[
                ["年化收益", percent(metrics.annualizedReturn)],
                ["累计费用", `¥${money(metrics.fees)}`],
                [
                  "成交 / 拒单",
                  `${metrics.filledOrders.toLocaleString()} / ${metrics.rejectedOrders.toLocaleString()}`,
                ],
                ["期末现金", `¥${money(cash)}`],
                ["回放交易日", String(metrics.days)],
                ["待成交订单", String(selected.result.pendingOrders)],
              ].map(([label, value]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
            {comparison && (
              <div className="research-comparison">
                <h3>与对照运行比较</h3>
                <p>相同回测区间 · 净值按各自初始本金归一化</p>
                <p>
                  对照数据：{comparison.run.name}
                  {datasetKey(selected.run.dataset) !== datasetKey(comparison.run.dataset) &&
                    " · 数据快照不同，差值同时包含数据变化的影响"}
                </p>
                <table className="research-table">
                  <thead>
                    <tr>
                      <th>指标</th>
                      <th className="numeric">本次运行</th>
                      <th className="numeric">对照运行</th>
                      <th className="numeric">差值</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(
                      [
                        [
                          "总收益",
                          metrics.totalReturn,
                          comparison.result.metrics.totalReturn,
                          true,
                        ],
                        [
                          "最大回撤",
                          metrics.maxDrawdown,
                          comparison.result.metrics.maxDrawdown,
                          true,
                        ],
                        ["Sharpe", metrics.sharpe, comparison.result.metrics.sharpe, false],
                      ] as const
                    ).map(([label, value, other, ratio]) => (
                      <tr key={label}>
                        <td>{label}</td>
                        <td className="numeric">{ratio ? percent(value) : value.toFixed(2)}</td>
                        <td className="numeric">{ratio ? percent(other) : other.toFixed(2)}</td>
                        <td className="numeric">
                          {ratio
                            ? `${((value - other) * 100).toFixed(2)} pp`
                            : (value - other).toFixed(2)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
        {tab === "orders" && <Orders services={services} result={selected.result} />}
        {tab === "holdings" && <Holdings result={selected.result} />}
        {tab === "decisions" && <Decisions services={services} selected={selected} />}
      </ResearchTabs>
    </div>
  );
}
