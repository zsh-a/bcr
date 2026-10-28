import {
  DEBT_COUNTRIES,
  DEBT_UNIT_LABELS,
  debtLatest,
  debtPhasePoint,
  formatDebtValue,
  getDebtSeries,
  type DebtSnapshot,
} from "@bcr/market-data/debt";
import { SERIES_TOKENS } from "../macro/state";
import { debtStatusLabel, type DebtViewState } from "./state";

export function DebtCards({
  snapshot,
  state,
  onSelect,
}: {
  snapshot: DebtSnapshot;
  state: DebtViewState;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="debt-country-cards">
      {state.countries.map((country, index) => {
        const leverage = debtLatest(getDebtSeries(snapshot, country, "privateDebt"), state.quarter),
          phase = debtPhasePoint(snapshot, country, state.quarter);
        return (
          <button
            className="debt-country-card"
            type="button"
            key={country}
            aria-pressed={country === state.focus}
            onClick={() => onSelect(country)}
            style={{ borderTopColor: `var(${SERIES_TOKENS[index]})` }}
          >
            <span>
              <i style={{ background: `var(${SERIES_TOKENS[index]})` }} />
              {DEBT_COUNTRIES.find((item) => item.id === country)?.name}
              <small>{country}</small>
            </span>
            <strong>
              {formatDebtValue(leverage?.value)}
              <small>% GDP</small>
            </strong>
            <span>居民＋非金融企业核心债务</span>
            <p>
              {leverage?.period ?? "暂无可用数据"}
              {leverage && leverage.period !== state.quarter ? " · 非当季观测" : ""}
            </p>
            <div>
              <span>偿债负担偏离本国均值</span>
              <b>
                {phase
                  ? `${phase.serviceDeviation >= 0 ? "+" : ""}${formatDebtValue(phase.serviceDeviation)} pp`
                  : "—"}
              </b>
            </div>
          </button>
        );
      })}
    </div>
  );
}
export function DebtPillars({ snapshot, state }: { snapshot: DebtSnapshot; state: DebtViewState }) {
  const country = state.focus ?? "",
    phase = debtPhasePoint(snapshot, country, state.quarter);
  const indicators = ["householdDebt", "corporateDebt", "governmentDebt", "debtService"] as const;
  const names = ["居民杠杆", "非金融企业杠杆", "一般政府杠杆", "私人部门偿债负担"];
  return (
    <div className="debt-pillars">
      {indicators.map((indicator, index) => {
        const series = getDebtSeries(snapshot, country, indicator),
          point = debtLatest(series, state.quarter);
        return (
          <article key={indicator}>
            <span>{names[index]}</span>
            <strong>
              {formatDebtValue(point?.value)}
              <small>{series ? DEBT_UNIT_LABELS[series.unit] : ""}</small>
            </strong>
            <p>
              {indicator === "governmentDebt"
                ? `${series?.valuation === "nominal" ? "名义" : series?.valuation === "market" ? "市场" : "来源"}估值 · 一般政府核心债务`
                : indicator === "corporateDebt"
                  ? "包含公营和私营非金融企业"
                  : indicator === "debtService"
                    ? phase
                      ? `过去 40 季均值 ${formatDebtValue(phase.baseline)}%`
                      : "历史窗口不足时不计算偏离"
                    : "住户及为住户服务的非营利机构"}
            </p>
            <small>
              {point?.period ?? "暂无数据"}
              {point && point.period !== state.quarter ? " · 非当季观测" : ""}{" "}
              {debtStatusLabel(point?.status)}
            </small>
          </article>
        );
      })}
    </div>
  );
}
