import { useEffect, useState } from "react";
import {
  BreadthHeatmap,
  Button,
  Select,
  Spinner,
  useNavigation,
  useLocationSearch,
} from "@bcr/react";
import { pinMarketSnapshot, saveMarketLabels } from "@bcr/market-data/research/catalog";
import type { SelectedRun } from "./session";
import { dateText, strategySpec, rebalanceSession } from "./model";
import { queryBreadthHistory, queryResearchDay } from "./result-reader";
import type { ResearchDayPage } from "./research-analysis";
import { CANDIDATE_REASONS, type ResearchDay } from "./research-model";
import { money, percent } from "./Orders";
import { Identity, useNames } from "./ResearchNames";

export function ExplanationPanel({ selected }: { selected: SelectedRun }) {
  const names = useNames();
  const spec = strategySpec(selected.run.config),
    momentum = spec.id === "momentum";
  const requestedDate = new URLSearchParams(useLocationSearch()).get("date");
  const navigation = useNavigation();
  const [openingMarket, setOpeningMarket] = useState(false);
  const openMarket = async () => {
    setOpeningMarket(true);
    try {
      await saveMarketLabels(selected.dataset, names);
      const id = await pinMarketSnapshot(selected.dataset);
      navigation.navigate(`/markets?view=breadth&snapshot=${id}&date=${date}`);
    } catch (e) {
      setError(String(e));
    } finally {
      setOpeningMarket(false);
    }
  };
  const sessions = selected.dataset.manifest.calendar.filter(
    (d) => d.date >= selected.run.startDate && d.date <= selected.run.endDate,
  );
  const dates = sessions.map((d) => dateText(d.date)),
    rebalances = selected.dataset.manifest.calendar
      .filter(
        (d, i) =>
          d.date >= selected.run.startDate &&
          d.date <= selected.run.endDate &&
          rebalanceSession(selected.dataset.manifest, i, spec),
      )
      .map((d) => dateText(d.date));
  const [date, setDate] = useState(
      requestedDate && dates.includes(requestedDate)
        ? requestedDate
        : (rebalances.at(-1) ?? dates.at(-1) ?? ""),
    ),
    [page, setPage] = useState(0),
    [historyPage, setHistoryPage] = useState(Math.max(0, Math.ceil(dates.length / 63) - 1));
  const [day, setDay] = useState<ResearchDayPage | null>(),
    [history, setHistory] = useState<Pick<ResearchDay, "date" | "breadth">[]>(),
    [error, setError] = useState("");
  const start = dates[historyPage * 63] ?? "",
    end = dates[Math.min(dates.length - 1, (historyPage + 1) * 63 - 1)] ?? "";
  useEffect(() => {
    if (!requestedDate || !dates.includes(requestedDate)) return;
    setDate(requestedDate);
    setPage(0);
    setHistoryPage(Math.floor(dates.indexOf(requestedDate) / 63));
  }, [requestedDate, selected.run.id]);
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
  const selectDate = (next: string) => {
    setDate(next);
    setPage(0);
    const index = dates.indexOf(next);
    if (index >= 0) setHistoryPage(Math.floor(index / 63));
  };
  return (
    <section className="research-insights" aria-label="策略选股解释">
      <div className="research-insights-tools">
        <h3>行业宽度 · MA{spec.lookback}</h3>
        <span className="research-help">
          {start} — {end}
        </span>
        <div className="research-insights-export">
          <Button
            size="sm"
            variant="ghost"
            disabled={openingMarket}
            onClick={() => void openMarket()}
          >
            在 Market 查看
          </Button>
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
        <BreadthHeatmap
          days={history}
          labels={names.industries}
          selectedDate={date}
          onSelect={(_, next) => selectDate(next)}
        />
      )}
      <p className="research-help">
        色深代表宽度，并非涨幅。每页最多 63 日；缺少 {spec.lookback}
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
              <dd>
                {day.breadth[0] ? (
                  <Identity code={day.breadth[0].industry} kind="industries" />
                ) : (
                  "历史不足"
                )}
              </dd>
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
                      <th className="numeric">{momentum ? "区间动量" : "原始市值"}</th>
                      <th>原因</th>
                    </tr>
                  </thead>
                  <tbody>
                    {day.candidates.map((c) => (
                      <tr key={c.code}>
                        <td className="numeric">{c.rank ?? "—"}</td>
                        <td>
                          <Identity code={c.code} />
                        </td>
                        <td>
                          <Identity code={c.industry} kind="industries" />
                        </td>
                        <td className="numeric">
                          {momentum
                            ? c.score == null
                              ? "—"
                              : percent(c.score)
                            : money(c.marketCap)}
                        </td>
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
                <span>
                  {day.candidateCount} 只 · {momentum ? "动量降序" : "市值升序"}
                </span>
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
        {momentum
          ? "按复权收益降序选择正动量证券，不使用盈利或市值筛选；行业宽度仅作为市场背景。"
          : "最宽行业用于决定是否空仓，证券候选来自整个选择宇宙。"}
        排名并列按证券代码排序。目标是收盘信号，实际持仓由次日成交和风控决定。
      </p>
    </section>
  );
}
