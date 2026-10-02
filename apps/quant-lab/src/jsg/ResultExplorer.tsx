import { lazy, Suspense, useEffect, useState } from "react";
import type { RuntimeServices } from "@bcr/core";
import { Button, Input, Spinner } from "@bcr/react";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { Orders, money, percent } from "./Orders";
import { dateText, type JsgResult } from "./model";
import { type SelectedRun } from "./session";
import { queryDecision } from "./result-reader";
import { ResearchTabs } from "./ResearchTabs";
import { ComparisonPanel } from "./ComparisonPanel";
import { EvaluationPanel } from "./EvaluationPanel";
import type { ClickHouseConnection } from "./clickhouse-http";
import type { BenchmarkBinding } from "./benchmark";
import { LedgerPanel } from "./LedgerPanel";
import { ExplanationPanel } from "./ExplanationPanel";
import { Identity } from "./ResearchNames";
import { ResearchInspection, useInspection } from "./ResearchInspection";
import { EventInspector } from "./EventInspector";

const ResearchChart = lazy(() => import("./ResearchChart"));

function Holdings({ result }: { result: JsgResult }) {
  const { focus, inspect } = useInspection();
  const [page, setPage] = useState(0);
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
                  <button
                    className="research-table-link"
                    onClick={() => inspect({ date: focus.date, code: holding.code })}
                  >
                    <Identity code={holding.code} />
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
    </>
  );
}
function Decisions({ services, selected }: { services: RuntimeServices; selected: SelectedRun }) {
  const { focus, selectDate: setDate, inspect, events } = useInspection();
  const dates = events.filter((event) => event.signal).map((event) => event.date);
  const date = focus.date;
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
              <dd>
                {value.topIndustry ? <Identity code={value.topIndustry} kind="industries" /> : "—"}
              </dd>
            </div>
            <div>
              <dt>行业宽度</dt>
              <dd>{percent(value.breadth / 100)}</dd>
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
              <button
                key={code}
                className="research-table-link"
                onClick={() => inspect({ date, code })}
              >
                <Identity code={code} />
              </button>
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
function Explorer({
  services,
  selected,
  comparisons,
  connection,
  busy,
  onBenchmark,
  onWorking,
}: {
  services: RuntimeServices;
  selected: SelectedRun;
  comparisons: SelectedRun[];
  connection: ClickHouseConnection;
  busy: boolean;
  onBenchmark: (runId: string, benchmark?: BenchmarkBinding) => void;
  onWorking: (value: boolean) => void;
}) {
  const [tab, setTab] = useState<"overview" | "orders" | "holdings" | "decisions" | "evaluation">(
    "overview",
  );
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
          { value: "evaluation", label: "分析" },
          { value: "orders", label: "成交", count: metrics.filledOrders + metrics.rejectedOrders },
          { value: "holdings", label: "账本" },
          { value: "decisions", label: "选股解释" },
        ]}
      >
        <div className="research-overview" hidden={tab !== "overview"}>
          <Suspense
            fallback={
              <div className="research-chart-loading">
                <Spinner />
                正在载入图表…
              </div>
            }
          >
            <ResearchChart
              key={selected.run.id}
              services={services}
              selected={selected}
              comparisons={comparisons}
            />
          </Suspense>
          <dl className="research-secondary-metrics">
            {[
              ["期末资产", `¥${money(metrics.finalEquity)}`],
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
          {comparisons.length > 0 && (
            <ComparisonPanel selected={selected} comparisons={comparisons} />
          )}
        </div>
        {tab === "orders" && (
          <Orders key={selected.run.id} services={services} result={selected.result} />
        )}
        {tab === "holdings" &&
          (selected.result.diagnostics ? (
            <LedgerPanel key={selected.run.id} selected={selected} />
          ) : (
            <>
              <p className="research-help">此运行只保存期末持仓，重新回测可生成每日盈亏账本。</p>
              <Holdings key={selected.run.id} result={selected.result} />
            </>
          ))}
        {tab === "decisions" &&
          (selected.result.diagnostics ? (
            <ExplanationPanel key={selected.run.id} selected={selected} />
          ) : (
            <Decisions key={selected.run.id} services={services} selected={selected} />
          ))}
        {tab === "evaluation" && (
          <EvaluationPanel
            key={selected.run.id}
            services={services}
            selected={selected}
            connection={connection}
            busy={busy}
            onBenchmark={onBenchmark}
            onWorking={onWorking}
          />
        )}
      </ResearchTabs>
      <EventInspector selected={selected} onNavigate={setTab} />
    </div>
  );
}

export function ResultExplorer(props: Parameters<typeof Explorer>[0]) {
  return (
    <ResearchInspection key={props.selected.run.id} selected={props.selected}>
      <Explorer {...props} />
    </ResearchInspection>
  );
}
