import { ArrowUpRight } from "lucide-react";
import { Dialog } from "@bcr/react";
import {
  DEBT_BIS_TRANSLATION_NOTE,
  DEBT_COUNTRIES,
  DEBT_FREQUENCY_LABELS,
  DEBT_INDICATORS,
  DEBT_UNIT_LABELS,
  debtLatest,
  formatDebtValue,
  type DebtSeries,
  type DebtSnapshot,
} from "@bcr/market-data/debt";
import { debtStatusLabel, debtTrendEnd, type DebtViewState } from "./state";
import { debtTableSeries } from "./export";

function SourceItem({ series }: { series: DebtSeries }) {
  return (
    <article className="debt-source-item">
      <header>
        <strong>
          {DEBT_COUNTRIES.find((item) => item.id === series.country)?.name} ·{" "}
          {DEBT_INDICATORS.find((item) => item.id === series.indicator)?.name}
        </strong>
        <span>
          {DEBT_FREQUENCY_LABELS[series.frequency]} · {DEBT_UNIT_LABELS[series.unit]}{" "}
          {series.currency} ·{" "}
          {series.valuation === "notApplicable"
            ? "估值不适用"
            : series.valuation === "nominal"
              ? "名义估值"
              : "市场估值"}{" "}
          ·{" "}
          {series.seasonalAdjustment === "NSA"
            ? "未季调"
            : series.seasonalAdjustment === "SA"
              ? "季调"
              : "季调不适用"}
        </span>
      </header>
      <p>{series.note}</p>
      <small>
        资源内最新观测 {debtLatest(series)?.period ?? "—"} · 来源更新日期{" "}
        {series.sourceUpdatedAt?.slice(0, 10) ?? "未提供"} · 抓取 {series.fetchedAt.slice(0, 10)}
      </small>
      <a href={series.source.url} target="_blank" rel="noopener noreferrer">
        {series.source.name} · {series.source.seriesCode}
        <ArrowUpRight size={12} />
      </a>
      <a href={series.source.licenseUrl} target="_blank" rel="noopener noreferrer">
        使用条款
        <ArrowUpRight size={12} />
      </a>
    </article>
  );
}
export function DebtData({
  snapshot,
  state,
  dialog,
  onClose,
}: {
  snapshot: DebtSnapshot;
  state: DebtViewState;
  dialog: "sources" | "table" | null;
  onClose: () => void;
}) {
  if (!dialog) return null;
  const metric = DEBT_INDICATORS.find((item) => item.id === state.metric)!;
  const available = DEBT_INDICATORS.filter((indicator) =>
    snapshot.series.some((series) => series.indicator === indicator.id),
  );
  return (
    <>
      <Dialog
        open={dialog === "sources"}
        onClose={onClose}
        title="债务数据 · 来源与统计口径"
        className="macro-data-dialog"
      >
        <p className="macro-caption">
          数据随项目打包，不自动请求外部接口。来源发布日期、抓取日期与观测季度分别记录；季度数据不插值成月度，也不将来源未提供的观测补为零。
        </p>
        <p className="macro-caption">
          BIS
          核心债务主要覆盖贷款、债券及货币和存款，不等于所有金融负债。非金融企业包括公营与私营企业；一般政府与企业的合并、估值口径不同，因此部门比较不额外计算“全社会总债务”。
        </p>
        <p className="macro-caption">
          相位图使用 BIS 信贷 / GDP 缺口，及 DSR 相对本国之前 40
          个连续季度均值的偏离。均值不含当季；不足 40
          季或缺期时不计算。零线是描述基准，不是风险阈值或衰退概率。
        </p>
        <div className="debt-coverage-scroll">
          <table className="macro-data-table">
            <caption>资源覆盖及各序列最新期次</caption>
            <thead>
              <tr>
                <th>指标</th>
                {state.countries.map((id) => (
                  <th key={id}>{DEBT_COUNTRIES.find((item) => item.id === id)?.name}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {available.map((indicator) => (
                <tr key={indicator.id}>
                  <th scope="row">{indicator.name}</th>
                  {state.countries.map((country) => (
                    <td key={country}>
                      {debtLatest(
                        snapshot.series.find(
                          (series) =>
                            series.country === country && series.indicator === indicator.id,
                        ),
                      )?.period ?? "—"}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div>
          {snapshot.series
            .filter((series) => state.countries.includes(series.country))
            .map((series) => (
              <SourceItem key={`${series.country}:${series.indicator}`} series={series} />
            ))}
        </div>
        <p className="macro-caption">{DEBT_BIS_TRANSLATION_NOTE}</p>
      </Dialog>
      <Dialog
        open={dialog === "table"}
        onClose={onClose}
        title={`${metric.name} · 债务数据表`}
        className="macro-data-dialog"
      >
        <p className="macro-caption">
          {metric.description} 趋势截至 {debtTrendEnd(snapshot, state)}，频率与原始值保持一致。—
          表示来源缺失，估计和预测按来源标记展示。
        </p>
        {debtTableSeries(snapshot, state).map(({ series, observations }) => (
          <section className="debt-native-table" key={series.country}>
            <h3>
              {DEBT_COUNTRIES.find((item) => item.id === series.country)?.name} ·{" "}
              {DEBT_FREQUENCY_LABELS[series.frequency]}
            </h3>
            <div
              className="macro-table-scroll"
              tabIndex={0}
              aria-label={`${series.country} 债务数据表`}
            >
              <table className="macro-data-table">
                <caption>
                  {series.source.name} · {DEBT_UNIT_LABELS[series.unit]} {series.currency}
                </caption>
                <thead>
                  <tr>
                    <th scope="col">原始期次</th>
                    <th scope="col">数值</th>
                    <th scope="col">来源状态</th>
                  </tr>
                </thead>
                <tbody>
                  {[...observations].reverse().map((point) => (
                    <tr key={point.period}>
                      <th scope="row">{point.period}</th>
                      <td>{formatDebtValue(point.value, series.unit, series.currency)}</td>
                      <td>{debtStatusLabel(point.status) || point.status || "来源未单列状态"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ))}
        {!debtTableSeries(snapshot, state).length && (
          <p className="macro-empty">所选经济体尚未收录此指标。</p>
        )}
      </Dialog>
    </>
  );
}
