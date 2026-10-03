import {
  TREND_PHASES,
  TREND_REASONS,
  periodLabel,
  type TrendContextDecision,
  type TrendResult,
} from "@bcr/quant-core/trend";
import { Button, PanelEmpty, Spinner, useRuntime } from "@bcr/react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useState } from "react";
import { readContextPage } from "./read";

const SIZE = 20;
const timestamp = (time: number) => new Date(time).toISOString().slice(0, 16).replace("T", " ");
const number = (n: number | null, digits = 2) =>
  n === null ? "—" : n.toLocaleString("zh-CN", { maximumFractionDigits: digits });

export function TrendContextPanel({
  result,
  minutes,
  onLocate,
}: {
  result: TrendResult;
  minutes: number;
  onLocate: (time: number) => void;
}) {
  const services = useRuntime();
  const [page, setPage] = useState(0);
  const [decisions, setDecisions] = useState<TrendContextDecision[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const summary = result.metrics.context;
  const count = summary?.evaluated ?? 0;
  useEffect(() => {
    const abort = new AbortController();
    setDecisions(null);
    setError(null);
    void readContextPage(services, result, page, SIZE, abort.signal)
      .then((value) => {
        if (!abort.signal.aborted) setDecisions(value);
      })
      .catch((e) => {
        if (!abort.signal.aborted) setError(String(e));
      });
    return () => abort.abort();
  }, [services, result, page, revision]);
  return (
    <section className="trend-context-panel" aria-label="入场背景分析">
      <div className="trend-context-heading">
        <div>
          <h3>{periodLabel(minutes)}背景 · 入场判断</h3>
          <p>在可开仓时评估候选信号，保留判断时的背景。背景通过后，仍需满足后续入场与成交条件。</p>
        </div>
        <div className="trend-context-counts">
          <span>
            已判断 <strong>{count}</strong>
          </span>
          <span>
            通过 <strong>{summary?.allowed ?? 0}</strong>
          </span>
          <span>
            拒绝 <strong>{summary?.rejected ?? 0}</strong>
          </span>
        </div>
      </div>
      {!!summary?.rejected && (
        <div className="trend-context-reasons" aria-label="背景拒绝原因统计">
          {Object.entries(summary.reasons)
            .sort((a, b) => b[1] - a[1])
            .map(([reason, total]) => (
              <span key={reason}>
                {TREND_REASONS[reason] ?? reason} <strong>{total}</strong>
              </span>
            ))}
        </div>
      )}
      {error ? (
        <p role="alert" className="trend-error">
          {error}
          <Button size="sm" variant="ghost" onClick={() => setRevision((n) => n + 1)}>
            重试
          </Button>
        </p>
      ) : !count ? (
        <PanelEmpty
          title="没有需要判断的入场信号"
          hint="背景持续更新；只有出现候选信号且允许开仓时，才记录入场判断。"
        />
      ) : (
        <>
          <div className="trend-table-scroll">
            <table>
              <thead>
                <tr>
                  {[
                    "信号时间 · UTC",
                    "方向",
                    "背景阶段",
                    "参考价格",
                    "方向效率",
                    "偏离 · 背景 ATR",
                    "成本 · 交易 ATR",
                    "判断",
                  ].map((label) => (
                    <th key={label}>{label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {decisions?.map((decision, i) => (
                  <tr key={decision.time}>
                    <td>
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label={`查看背景信号 ${page * SIZE + i + 1}`}
                        onClick={() => onLocate(decision.time)}
                      >
                        {timestamp(decision.time)}
                      </Button>
                      <small>
                        背景截至 {decision.asOf === null ? "—" : timestamp(decision.asOf)}
                      </small>
                    </td>
                    <td>
                      {decision.side === "long" ? "做多" : "做空"}
                      <small>{number(decision.price)}</small>
                    </td>
                    <td>{TREND_PHASES[decision.phase]}</td>
                    <td>
                      EMA {number(decision.reference)}
                      <small>结构 {number(decision.anchor)}</small>
                    </td>
                    <td>
                      {decision.efficiency === null
                        ? "—"
                        : `${number(decision.efficiency * 100, 0)}%`}
                    </td>
                    <td>{number(decision.extensionAtr)}</td>
                    <td>{number(decision.costAtr)}</td>
                    <td>
                      <span className="trend-context-verdict" data-allowed={decision.allowed}>
                        {TREND_REASONS[decision.reason] ?? decision.reason}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!decisions && <Spinner />}
          </div>
          <div className="trend-pagination">
            <span>
              {page + 1} / {Math.ceil(count / SIZE)}
            </span>
            <Button
              size="sm"
              aria-label="上一页背景"
              disabled={page === 0 || !decisions}
              onClick={() => setPage((n) => n - 1)}
            >
              <ChevronLeft size={15} />
            </Button>
            <Button
              size="sm"
              aria-label="下一页背景"
              disabled={(page + 1) * SIZE >= count || !decisions}
              onClick={() => setPage((n) => n + 1)}
            >
              <ChevronRight size={15} />
            </Button>
          </div>
        </>
      )}
      <p className="trend-help">
        每个拒绝信号只统计首个阻断原因。方向效率与均线偏离衡量背景，成本按双边费用、滑点和价格取整保守估算；
        不包含未来资金费或真实盘口冲击。固定规则仍需与无过滤基线作样本外比较。
      </p>
    </section>
  );
}
