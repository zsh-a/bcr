import {
  CYCLE_COUNTRIES,
  cycleSeriesHealth,
  getCycleSeries,
  shiftMonth,
  type CycleSnapshot,
} from "@bcr/market-data/cycle";
import { cycleTrendEnd, type CycleViewState } from "./state";
import { frequencyLabel } from "./CycleData";

export function CycleHealth({
  snapshot,
  state,
}: {
  snapshot: CycleSnapshot;
  state: CycleViewState;
}) {
  const end = cycleTrendEnd(snapshot, state),
    start =
      state.window === "all" ? "2000-01" : shiftMonth(end, state.window === "10y" ? -119 : -59);
  const focused = getCycleSeries(snapshot, state.focus ?? "", state.metric);
  const context = focused?.note?.split("输入与来源：")[0]?.trim();
  return (
    <div className="cycle-health-area">
      {context && (
        <details className="cycle-country-definition">
          <summary>
            <strong>
              {CYCLE_COUNTRIES.find((country) => country.id === state.focus)?.name} · 口径说明
            </strong>
            <span>{context.length > 180 ? `${context.slice(0, 180)}…` : context}</span>
          </summary>
          <p>{focused?.note}</p>
        </details>
      )}
      <details className="cycle-health">
        <summary>
          数据时效与覆盖 <span>截止 {end} · 缺期与修订另列</span>
        </summary>
        <div className="cycle-coverage-scroll" tabIndex={0} aria-label="周期指标时效与覆盖表">
          <table className="macro-data-table">
            <caption>
              月、季频按所选窗口计算覆盖；日、周频仅列有效记录，不推算交易日或发布周。
            </caption>
            <thead>
              <tr>
                <th scope="col">经济体</th>
                <th scope="col">最新可用期次</th>
                <th scope="col">距截止</th>
                <th scope="col">窗口覆盖</th>
                <th scope="col">来源更新日期</th>
                <th scope="col">抓取日期</th>
              </tr>
            </thead>
            <tbody>
              {state.countries.map((country) => {
                const series = getCycleSeries(snapshot, country, state.metric),
                  health = series ? cycleSeriesHealth(series, start, end) : null;
                return (
                  <tr key={country}>
                    <th scope="row">{CYCLE_COUNTRIES.find((item) => item.id === country)?.name}</th>
                    <td>
                      {health?.latestPeriod ?? "未收录"}
                      {series
                        ? ` · ${frequencyLabel[series.frequency]}${health?.derived ? " · 计算值" : ""}`
                        : ""}
                    </td>
                    <td>
                      {health?.ageMonths === null || !health ? "—" : `${health.ageMonths} 个月`}
                    </td>
                    <td>
                      {health
                        ? health.expected !== null
                          ? `${health.valid}/${health.expected} 期`
                          : `${health.valid}/${health.reported} 条有效`
                        : "—"}
                    </td>
                    <td>{series?.sourceUpdatedAt?.slice(0, 10) ?? "未披露"}</td>
                    <td>{series?.fetchedAt.slice(0, 10) ?? "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p>
          观测距截止的月份差不是发布延迟。来源更新日期不代表各历史值首次公布日；计算值没有独立机构发布日期。
        </p>
      </details>
    </div>
  );
}
