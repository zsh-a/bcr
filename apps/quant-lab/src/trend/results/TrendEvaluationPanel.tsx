import type { TrendMetrics } from "@bcr/quant-core/trend";
import { trendEvaluationView, type EvaluationWindow, type MetricDisplay } from "./evaluation";

function MetricGrid({ rows, overview = false }: { rows: MetricDisplay[]; overview?: boolean }) {
  return (
    <dl className={`trend-metrics${overview ? " trend-overview-metrics" : ""}`}>
      {rows.map((metric) => (
        <div key={metric.id} data-metric={metric.id} title={metric.help}>
          <dt>{metric.label}</dt>
          <dd>{metric.value}</dd>
          {metric.unit && <small>{metric.unit}</small>}
        </div>
      ))}
    </dl>
  );
}

export function TrendEvaluationPanel({
  metrics,
  window,
}: {
  metrics: TrendMetrics;
  window: EvaluationWindow;
}) {
  const view = trendEvaluationView(metrics, window);
  return (
    <section className="trend-evaluation-panel" aria-label="趋势策略评价">
      <MetricGrid rows={view.overview} overview />
      <p className="trend-help">
        最大回撤按分钟权益记录；最长回撤时长包含期末尚未恢复的区间。回测覆盖时长不含预热。
      </p>
      {!view.current && (
        <p className="trend-help trend-evaluation-legacy">
          旧结果未记录完整评价字段，缺失项显示 —；保留当时的指标，不从抽样净值推算。
        </p>
      )}
      <details className="trend-evaluation">
        <summary>收益质量与交易管理</summary>
        {view.groups.map((group) => (
          <section className="trend-metric-group" key={group.title} aria-label={group.title}>
            <h3>{group.title}</h3>
            <MetricGrid rows={group.metrics} />
          </section>
        ))}
        <p className="trend-help">
          净利润因子、净期望与胜率按扣费后的交易统计；平均净亏损取亏损绝对值，以正数表示。
          滑点与取整影响已计入成交价格，净收益中不再重复扣除；资金费净支出为负表示收到资金费。
          趋势收益可能集中在少数交易，集中度仅作诊断，需结合区间长度、交易样本与独立验证判断。
        </p>
        <div className="trend-accounting">
          <span>最长连亏 {metrics.longestLossStreak}</span>
          <span>被拒绝信号 {metrics.rejectedSignals}</span>
          <span>完整 UTC 日 {metrics.evaluation?.totalDays ?? "—"}</span>
          {view.exits.map((exit) => (
            <span key={exit.label}>
              {exit.label} {exit.count}
            </span>
          ))}
        </div>
        <p className="trend-help">
          Sharpe、Sortino 与波动率使用完整 UTC 日收益，365 日年化、零无风险收益率。30
          个完整日仅为指标展示门槛，短样本年化不能证明长期能力。 Calmar
          使用年化净收益与分钟级最大回撤。无有效分母或样本不足时显示 —。
          {view.current ? "评价 v2 · 指标来自完整回放账本。" : "该运行保留历史评价口径。"}
        </p>
      </details>
      <details className="trend-validation-evidence">
        <summary>
          验证证据 <span>尚未绑定</span>
        </summary>
        <p className="trend-help">
          当前为单次回测，尚未绑定独立样本外、滚动验证或成本压力测试来源。
          这里的收益与风险指标描述本次运行，不代表已通过这些验证。
        </p>
        <p className="trend-help">
          验证记录需要明确训练与测试区间、冻结参数、数据和执行版本，并能追溯到对应结果。
        </p>
      </details>
    </section>
  );
}

export function TrendMonthlyReturns({
  metrics,
  window,
}: {
  metrics: TrendMetrics;
  window: EvaluationWindow;
}) {
  const { monthly } = trendEvaluationView(metrics, window);
  return (
    <section className="trend-monthly" aria-label="月度收益">
      <div className="trend-table-toolbar">
        <h3>月度收益</h3>
        <span className="trend-help">UTC · 含成本 · 按期初权益复合计算</span>
      </div>
      {monthly ? (
        <div className="trend-table-scroll">
          <table>
            <thead>
              <tr>
                <th>月份</th>
                <th>覆盖</th>
                <th>净收益</th>
                <th>期末资金 · USDT</th>
              </tr>
            </thead>
            <tbody>
              {monthly.map((period) => (
                <tr key={period.key}>
                  <td>
                    {period.month}
                    {!period.complete && <span className="trend-partial">部分月份</span>}
                  </td>
                  <td title={`${period.from} — ${period.to} UTC`}>{period.duration}</td>
                  <td data-positive={period.positive}>{period.returnPct}</td>
                  <td>{period.equity}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="trend-help">旧结果未保存完整月度收益，不从抽样净值推算。</p>
      )}
    </section>
  );
}
