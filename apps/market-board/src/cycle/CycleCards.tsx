import {
  CYCLE_COUNTRIES,
  CYCLE_PHASE_LABELS,
  cyclePoint,
  formatCycleValue,
  cycleLatest,
  getCycleSeries,
  threeMonthGrowth,
  cycleDisplayObservations,
  monthIndex,
  observationMonth,
  type CycleSnapshot,
} from "@bcr/market-data/cycle";
import { SERIES_TOKENS } from "../macro/state";

export function CycleCards({
  snapshot,
  countries,
  period,
  focus,
  onFocus,
}: {
  snapshot: CycleSnapshot;
  countries: string[];
  period: string;
  focus: string | null;
  onFocus: (country: string) => void;
}) {
  return (
    <div className="cycle-country-cards">
      {countries.map((country, index) => {
        const point = cyclePoint(snapshot, country, period);
        return (
          <button
            key={country}
            className="cycle-country-card"
            type="button"
            aria-pressed={focus === country}
            onClick={() => onFocus(country)}
            style={{ borderTopColor: `var(${SERIES_TOKENS[index]})` }}
          >
            <span>
              <i style={{ background: `var(${SERIES_TOKENS[index]})` }} />
              {CYCLE_COUNTRIES.find((item) => item.id === country)?.name ?? country}
              <small>{country}</small>
            </span>
            <strong>{formatCycleValue(point?.level)}</strong>
            <span className="cycle-card-phase">
              {point ? CYCLE_PHASE_LABELS[point.phase] : "本期 CLI 数据不足"}
            </span>
            <span className="cycle-card-momentum">
              Δ3M {point ? `${point.momentum >= 0 ? "+" : ""}${point.momentum.toFixed(2)}` : "—"}
              <small>指数点 · {period}</small>
            </span>
          </button>
        );
      })}
    </div>
  );
}
export function CyclePillars({
  snapshot,
  country,
  period,
}: {
  snapshot: CycleSnapshot;
  country: string | null;
  period: string;
}) {
  const id = country ?? "",
    cli = cyclePoint(snapshot, id, period);
  const production = getCycleSeries(snapshot, id, "industrialProduction"),
    demand =
      getCycleSeries(snapshot, id, "realConsumption") ??
      getCycleSeries(snapshot, id, "retailVolume") ??
      getCycleSeries(snapshot, id, "retailNominal"),
    labor = getCycleSeries(snapshot, id, "unemployment");
  const current = (series: typeof production) => cycleLatest(series, period);
  const momentum = (series: typeof production) => {
    const point = current(series);
    if (!series || !point) return { value: null, label: "暂无可用数据", date: "—" };
    const short = threeMonthGrowth(series, point.period);
    const yearly =
      cycleDisplayObservations(series).find((item) => item.period === point.period)?.value ?? null;
    return {
      value: short ?? yearly,
      label: short === null ? "同比" : "相邻三个月均值变化（未折年）",
      date: point.period,
    };
  };
  const output = momentum(production),
    spending = momentum(demand),
    employment = current(labor);
  const stale = (date: string) => monthIndex(period) - monthIndex(observationMonth(date)) > 2;
  const items = [
    {
      title: "领先景气",
      value: cli?.level ?? null,
      unit: "index" as const,
      label: cli ? CYCLE_PHASE_LABELS[cli.phase] : "需要本月及三个月前的 CLI",
      date: cli?.period ?? "—",
    },
    {
      title: "生产动量",
      value: stale(output.date) ? null : output.value,
      unit: "percent" as const,
      label: `${output.label}${stale(output.date) ? " · 数据滞后" : ""}`,
      date: output.date,
    },
    {
      title:
        demand?.indicator === "realConsumption"
          ? "实际消费动量"
          : demand?.indicator === "retailNominal"
            ? "零售名义变化"
            : "实际零售动量",
      value: stale(spending.date) ? null : spending.value,
      unit: "percent" as const,
      label: `${spending.label}${stale(spending.date) ? " · 数据滞后" : ""}`,
      date: spending.date,
    },
    {
      title: "就业 · 失业率",
      value: employment && !stale(employment.period) ? employment.value : null,
      unit: "percent" as const,
      label: labor
        ? labor.seasonalAdjustment === "SA"
          ? "官方季调序列"
          : "原始口径见数据来源"
        : "暂无可用数据",
      date: employment?.period ?? "—",
    },
  ];
  return (
    <section className="cycle-pillars" aria-label="周期分项状态">
      {items.map((item) => (
        <article key={item.title}>
          <span>{item.title}</span>
          <strong>{formatCycleValue(item.value, item.unit)}</strong>
          <p>{item.label}</p>
          <small>{item.date}</small>
        </article>
      ))}
    </section>
  );
}
