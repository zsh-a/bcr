import { useEffect, useState } from "react";
import { Button, Input, Select, Spinner } from "@bcr/react";
import { Download } from "lucide-react";
import { dateText } from "./model";
import type { SelectedRun } from "./session";
import { queryResearchDay, queryResearchSummary } from "./result-reader";
import type { ResearchSummary, ResearchDayPage } from "./research-analysis";
import { money, percent } from "./Orders";
import { downloadText, ledgerCsv, researchReport } from "./report";
import { Identity, useNames } from "./ResearchNames";
import { displayLabel } from "./display-names";

export function LedgerPanel({ selected }: { selected: SelectedRun }) {
  const names = useNames();
  const [mode, setMode] = useState("history"),
    [date, setDate] = useState(dateText(selected.run.endDate)),
    [page, setPage] = useState(0);
  const [summary, setSummary] = useState<ResearchSummary>(),
    [day, setDay] = useState<ResearchDayPage | null>(),
    [error, setError] = useState(""),
    [summaryError, setSummaryError] = useState("");
  useEffect(() => {
    const abort = new AbortController();
    void queryResearchSummary(selected.result, selected.run.config.initialCapital, abort.signal)
      .then(setSummary)
      .catch((e) => {
        if (!abort.signal.aborted) setSummaryError(String(e));
      });
    return () => abort.abort();
  }, [selected]);
  useEffect(() => {
    if (mode !== "history") return;
    const abort = new AbortController();
    setDay(undefined);
    setError("");
    void queryResearchDay(selected.result, date, page * 50, abort.signal)
      .then(setDay)
      .catch((e) => {
        if (!abort.signal.aborted) setError(String(e));
      });
    return () => abort.abort();
  }, [selected, date, page, mode]);
  const rows = mode === "history" ? day?.ledger : summary?.assets.slice(page * 50, page * 50 + 50);
  const count = mode === "history" ? (day?.ledgerCount ?? 0) : (summary?.assets.length ?? 0);
  return (
    <section className="research-insights" aria-label="持仓与盈亏账本">
      <div className="research-insights-tools">
        <Select
          aria-label="账本视图"
          value={mode}
          onChange={(e) => {
            setMode(e.target.value);
            setPage(0);
          }}
        >
          <option value="history">历史持仓</option>
          <option value="attribution">收益归因</option>
          <option value="risk">回撤与滚动风险</option>
        </Select>
        {mode === "history" && (
          <Input
            type="date"
            aria-label="持仓日期"
            value={date}
            min={dateText(selected.run.startDate)}
            max={dateText(selected.run.endDate)}
            onChange={(e) => {
              setDate(e.target.value);
              setPage(0);
            }}
          />
        )}
        <div className="research-insights-export">
          <Button
            size="sm"
            variant="ghost"
            disabled={!summary}
            onClick={() =>
              summary &&
              downloadText(ledgerCsv(summary, names), "jsg-ledger.csv", "text/csv;charset=utf-8")
            }
          >
            <Download size={14} />
            账本 CSV
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={!summary}
            onClick={() =>
              summary &&
              downloadText(
                researchReport(selected, summary, names),
                "jsg-report.html",
                "text/html;charset=utf-8",
              )
            }
          >
            研究报告
          </Button>
        </div>
      </div>
      {(error || summaryError) && (
        <p role="alert" className="research-error">
          {error || summaryError}
        </p>
      )}
      {mode === "history" && day && (
        <dl className="research-secondary-metrics">
          {[
            ["现金", day.cash],
            ["持仓市值", day.equity - day.cash - day.receivables],
            ["应收款", day.receivables],
            ["当日资产", day.equity],
          ].map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd>¥{money(Number(v))}</dd>
            </div>
          ))}
        </dl>
      )}
      {mode === "attribution" && summary && (
        <>
          <dl className="research-secondary-metrics">
            {[
              ["净盈亏", summary.profit],
              ["已实现", summary.realized],
              ["未实现", summary.unrealized],
              ["累计费用", summary.fees],
            ].map(([k, v]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd>¥{money(Number(v))}</dd>
              </div>
            ))}
          </dl>
          <div className="research-insights-scroll">
            <table className="research-table">
              <caption>行业净贡献与期末暴露</caption>
              <thead>
                <tr>
                  <th>行业</th>
                  <th className="numeric">净贡献</th>
                  <th className="numeric">市值</th>
                  <th className="numeric">仓位</th>
                </tr>
              </thead>
              <tbody>
                {summary.industries.map((s) => (
                  <tr key={s.industry}>
                    <td>
                      <Identity code={s.industry} kind="industries" />
                    </td>
                    <td className="numeric">{money(s.profit)}</td>
                    <td className="numeric">{money(s.value)}</td>
                    <td className="numeric">{percent(s.weight)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      {mode !== "risk" &&
        (rows ? (
          <>
            <div className="research-insights-scroll">
              <table className="research-table">
                <thead>
                  <tr>
                    <th>证券 / 行业</th>
                    <th className="numeric">数量</th>
                    <th className="numeric">市值 / 仓位</th>
                    <th className="numeric">{mode === "history" ? "当日盈亏" : "净盈亏"}</th>
                    <th className="numeric">已实现 / 未实现</th>
                    <th>估值日</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((a) => (
                    <tr key={a.code}>
                      <td>
                        <Identity code={a.code} />
                        <small className="research-cell-note">
                          {displayLabel(names, "industries", a.industry)}
                        </small>
                      </td>
                      <td className="numeric">{a.quantity.toLocaleString()}</td>
                      <td className="numeric">
                        {money(a.value)}
                        <small className="research-cell-note">{percent(a.weight)}</small>
                      </td>
                      <td className="numeric">
                        {money(mode === "history" ? a.dailyProfit : a.profit)}
                      </td>
                      <td className="numeric">
                        {money(a.realized)} / {money(a.unrealized)}
                      </td>
                      <td>
                        {a.markDate}
                        {mode === "history" && a.quantity > 0 && a.markDate !== date
                          ? " · 旧价格"
                          : ""}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!rows.length && <p className="research-small-empty">此页没有持仓或账本变动。</p>}
            <div className="research-pagination">
              <span>共 {count} 条</span>
              <div>
                <Button size="sm" disabled={!page} onClick={() => setPage((p) => p - 1)}>
                  上一页
                </Button>
                <Button
                  size="sm"
                  disabled={(page + 1) * 50 >= count}
                  onClick={() => setPage((p) => p + 1)}
                >
                  下一页
                </Button>
              </div>
            </div>
          </>
        ) : (
          !error && (
            <p className="research-small-empty">
              {day === null ? (
                "该日不是回测交易日。"
              ) : (
                <>
                  <Spinner size="sm" />
                  读取完整账本…
                </>
              )}
            </p>
          )
        ))}
      {mode === "risk" && summary && (
        <>
          <h3>最深回撤区间 · 前 50 项</h3>
          <div className="research-insights-scroll">
            <table className="research-table">
              <thead>
                <tr>
                  <th>峰值 → 谷底</th>
                  <th>恢复</th>
                  <th className="numeric">深度</th>
                  <th className="numeric">持续交易日</th>
                </tr>
              </thead>
              <tbody>
                {summary.episodes.slice(0, 50).map((e) => (
                  <tr key={e.peak}>
                    <td>
                      {e.peak} → {e.trough}
                    </td>
                    <td>{e.recovered ?? "尚未恢复"}</td>
                    <td className="numeric">{percent(e.depth)}</td>
                    <td className="numeric">{e.sessions}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <h3>63 日滚动观察 · 最近 20 个采样点</h3>
          <div className="research-insights-scroll">
            <table className="research-table">
              <thead>
                <tr>
                  <th>日期</th>
                  <th className="numeric">收益</th>
                  <th className="numeric">年化波动</th>
                  <th className="numeric">Sharpe</th>
                </tr>
              </thead>
              <tbody>
                {summary.rolling.slice(-20).map((r) => (
                  <tr key={r.date}>
                    <td>{r.date}</td>
                    <td className="numeric">{percent(r.return)}</td>
                    <td className="numeric">{percent(r.volatility)}</td>
                    <td className="numeric">{r.sharpe.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!summary.rolling.length && (
            <p className="research-help">需要至少 63 个交易日才能计算滚动统计。</p>
          )}
        </>
      )}
      {mode === "risk" && !summary && !summaryError && (
        <p className="research-small-empty">
          <Spinner size="sm" />
          计算完整账本与风险…
        </p>
      )}
      <p className="research-help">
        费用已计入净盈亏，滑点包含在成交价中。已实现 = 累计净盈亏 −
        未实现；股票成本含买入费用；送转股分摊成本，现金分红计入收入。对账覆盖现金、持仓和应收款。
      </p>
    </section>
  );
}
