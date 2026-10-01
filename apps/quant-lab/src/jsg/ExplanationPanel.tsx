import { useEffect, useState } from "react";
import { Button, Select, Spinner } from "@bcr/react";
import type { SelectedRun } from "./session";
import { dateText } from "./model";
import { queryBreadthHistory, queryResearchDay } from "./result-reader";
import type { ResearchDayPage } from "./research-analysis";
import { CANDIDATE_REASONS, type ResearchDay } from "./research-model";
import { money } from "./Orders";

export function ExplanationPanel({ selected }: { selected: SelectedRun }) {
  const sessions = selected.dataset.manifest.calendar.filter(
    (d) => d.date >= selected.run.startDate && d.date <= selected.run.endDate,
  );
  const dates = sessions.map((d) => dateText(d.date)),
    rebalances = sessions.filter((d) => d.rebalance).map((d) => dateText(d.date));
  const [date, setDate] = useState(rebalances.at(-1) ?? dates.at(-1) ?? ""),
    [page, setPage] = useState(0),
    [historyPage, setHistoryPage] = useState(Math.max(0, Math.ceil(dates.length / 63) - 1));
  const [day, setDay] = useState<ResearchDayPage | null>(),
    [history, setHistory] = useState<Pick<ResearchDay, "date" | "breadth">[]>(),
    [error, setError] = useState("");
  const start = dates[historyPage * 63] ?? "",
    end = dates[Math.min(dates.length - 1, (historyPage + 1) * 63 - 1)] ?? "";
  useEffect(() => {
    const abort = new AbortController();
    setDay(undefined);
    setError("");
    void queryResearchDay(selected.result, date, page * 50, abort.signal)
      .then(setDay)
      .catch((e) => {
        if (!abort.signal.aborted) setError(String(e));
      });
    return () => abort.abort();
  }, [selected, date, page]);
  useEffect(() => {
    const abort = new AbortController();
    setHistory(undefined);
    void queryBreadthHistory(selected.result, start, end, abort.signal)
      .then(setHistory)
      .catch((e) => {
        if (!abort.signal.aborted) setError(String(e));
      });
    return () => abort.abort();
  }, [selected, start, end]);
  const industries = [
    ...new Set(history?.flatMap((d) => d.breadth.map((b) => b.industry)) ?? []),
  ].sort();
  const selectDate = (next: string) => {
    setDate(next);
    setPage(0);
    const index = dates.indexOf(next);
    if (index >= 0) setHistoryPage(Math.floor(index / 63));
  };
  return (
    <section className="research-insights" aria-label="JSG 选股解释">
      <div className="research-insights-tools">
        <h3>行业宽度 · MA20</h3>
        <span className="research-help">
          {start} — {end}
        </span>
        <div className="research-insights-export">
          <Button
            size="sm"
            variant="ghost"
            disabled={!historyPage}
            onClick={() => setHistoryPage((p) => p - 1)}
          >
            更早
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={(historyPage + 1) * 63 >= dates.length}
            onClick={() => setHistoryPage((p) => p + 1)}
          >
            更晚
          </Button>
        </div>
      </div>
      {error && (
        <p role="alert" className="research-error">
          {error}
        </p>
      )}
      {history && (
        <div className="research-insights-scroll research-breadth-map">
          <table>
            <caption className="sr-only">行业中复权收盘价高于 20 日均线的证券占比</caption>
            <thead>
              <tr>
                <th>行业</th>
                {history.map((d) => (
                  <th key={d.date}>{d.date.slice(5)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {industries.map((industry) => (
                <tr key={industry}>
                  <th>{industry}</th>
                  {history.map((d) => {
                    const b = d.breadth.find((v) => v.industry === industry);
                    const label = `${d.date} ${industry} ${b ? `${b.ratio}% · ${b.above}/${b.total}` : "历史不足"}`;
                    return (
                      <td key={d.date}>
                        <button
                          aria-label={label}
                          title={label}
                          style={
                            b
                              ? {
                                  background: `color-mix(in srgb, var(--color-accent) ${8 + b.ratio * 0.32}%, var(--color-surface))`,
                                }
                              : undefined
                          }
                          onClick={() => {
                            selectDate(d.date);
                          }}
                        >
                          {b ? Math.round(b.ratio) : "—"}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="research-help">
        色深代表宽度，并非涨幅。每页最多 63 日；缺少 20
        次行情观测的成员不计入宽度，缺少可计算成员显示空白。点击日期查看当日候选。
      </p>
      <div className="research-insights-tools">
        <h3>候选排名与筛选原因</h3>
        <Select
          aria-label="解释日期"
          value={date}
          onChange={(e) => {
            selectDate(e.target.value);
          }}
        >
          {!rebalances.includes(date) && <option value={date}>{date} · 非调仓日</option>}
          {rebalances.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </Select>
      </div>
      {day ? (
        <>
          <dl className="research-secondary-metrics">
            <div>
              <dt>当日最宽行业</dt>
              <dd>{day.breadth[0]?.industry ?? "历史不足"}</dd>
            </div>
            <div>
              <dt>宽度</dt>
              <dd>{day.breadth[0] ? `${day.breadth[0].ratio}%` : "—"}</dd>
            </div>
            <div>
              <dt>目标信号</dt>
              <dd>{day.reasons["target"] ?? 0} 只</dd>
            </div>
          </dl>
          <div className="research-reason-summary">
            {Object.entries(day.reasons).map(([reason, count]) => (
              <span key={reason}>
                {CANDIDATE_REASONS[reason] ?? reason} <b>{count}</b>
              </span>
            ))}
          </div>
          {day.candidateCount ? (
            <>
              <div className="research-insights-scroll">
                <table className="research-table">
                  <thead>
                    <tr>
                      <th className="numeric">排名</th>
                      <th>证券</th>
                      <th>行业</th>
                      <th className="numeric">原始市值</th>
                      <th>原因</th>
                    </tr>
                  </thead>
                  <tbody>
                    {day.candidates.map((c) => (
                      <tr key={c.code}>
                        <td className="numeric">{c.rank ?? "—"}</td>
                        <td>{c.code}</td>
                        <td>{c.industry}</td>
                        <td className="numeric">{money(c.marketCap)}</td>
                        <td>
                          {CANDIDATE_REASONS[c.reason] ?? c.reason}
                          {!c.tradable && (
                            <small className="research-cell-note">停牌 · 成交受限</small>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="research-pagination">
                <span>{day.candidateCount} 只 · 市值升序</span>
                <div>
                  <Button size="sm" disabled={!page} onClick={() => setPage((p) => p - 1)}>
                    上一页
                  </Button>
                  <Button
                    size="sm"
                    disabled={(page + 1) * 50 >= day.candidateCount}
                    onClick={() => setPage((p) => p + 1)}
                  >
                    下一页
                  </Button>
                </div>
              </div>
            </>
          ) : (
            <p className="research-small-empty">该日没有调仓候选记录。</p>
          )}
        </>
      ) : (
        !error && (
          <p className="research-small-empty">
            {day === null ? (
              "该日不是回测交易日。"
            ) : (
              <>
                <Spinner size="sm" />
                读取选股解释…
              </>
            )}
          </p>
        )
      )}
      <p className="research-help">
        最宽行业用于决定是否空仓，证券候选来自整个选择宇宙。排名并列按证券代码排序。目标是收盘信号，实际持仓由次日成交和风控决定。
      </p>
    </section>
  );
}
