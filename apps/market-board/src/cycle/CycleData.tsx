import { ArrowUpRight } from "lucide-react";
import { Dialog } from "@bcr/react";
import {
  CYCLE_COUNTRIES,
  CYCLE_INDICATORS,
  cycleDisplayObservations,
  cycleDisplayUnit,
  cycleLatest,
  formatCycleValue,
  getCycleSeries,
  monthIndex,
  observationMonth,
  shiftMonth,
  type CycleSeries,
  type CycleSnapshot,
} from "@bcr/market-data/cycle";
import { cycleTrendEnd, type CycleViewState } from "./state";

export const frequencyLabel = { M: "月度", Q: "季度", W: "周度", D: "日度" };
export const adjustmentLabel = { SA: "季调", NSA: "未季调", notApplicable: "季调不适用" };
export const unitLabel = {
  index: "指数",
  percent: "%",
  percentagePoints: "百分点",
  thousandPersons: "千人",
  persons: "人",
  billionsUsd: "十亿美元",
  thousandUnits: "千套",
  hours: "小时",
  ratio: "倍",
};
export function cycleTableSeries(snapshot: CycleSnapshot, state: CycleViewState) {
  const end = cycleTrendEnd(snapshot, state);
  return state.countries.flatMap((country) => {
    const series = getCycleSeries(snapshot, country, state.metric);
    if (!series) return [];
    const start =
      state.window === "all" ? "2000-01" : shiftMonth(end, state.window === "10y" ? -119 : -59);
    return [
      {
        series,
        points: cycleDisplayObservations(series).filter(
          (point) =>
            observationMonth(point.period) >= start && observationMonth(point.period) <= end,
        ),
      },
    ];
  });
}
export function cycleCsv(snapshot: CycleSnapshot, state: CycleViewState) {
  const rows: (string | number | null)[][] = [
    [
      "country",
      "indicator",
      "period",
      "display_value",
      "display_unit",
      "raw_value",
      "raw_unit",
      "frequency",
      "seasonal_adjustment",
      "status",
      "source",
      "series_code",
      "source_url",
      "fetched_at",
      "source_updated_at",
      "license_url",
      "note",
    ],
  ];
  for (const { series, points } of cycleTableSeries(snapshot, state)) {
    for (const point of points)
      rows.push([
        series.country,
        series.indicator,
        point.period,
        point.value,
        cycleDisplayUnit(series),
        series.observations.find((raw) => raw.period === point.period)?.value ?? null,
        series.unit,
        series.frequency,
        series.seasonalAdjustment,
        point.status ?? "",
        series.source.name,
        series.source.seriesCode,
        series.source.url,
        series.fetchedAt,
        series.sourceUpdatedAt,
        series.source.licenseUrl ?? "",
        series.note ?? "",
      ]);
  }
  return `\uFEFF${rows.map((row) => row.map((cell) => `"${String(cell ?? "").replaceAll('"', '""')}"`).join(",")).join("\r\n")}`;
}
export function CycleReadout({
  snapshot,
  state,
}: {
  snapshot: CycleSnapshot;
  state: CycleViewState;
}) {
  return (
    <div className="cycle-readouts" aria-label="当前指标数值">
      {state.countries.map((id) => {
        const series = getCycleSeries(snapshot, id, state.metric),
          end = cycleTrendEnd(snapshot, state),
          point = cycleLatest(series, end);
        const age = point ? monthIndex(end) - monthIndex(observationMonth(point.period)) : 0;
        const value =
          series && point
            ? cycleDisplayObservations(series).find((item) => item.period === point.period)?.value
            : null;
        return (
          <div key={id}>
            <span>{CYCLE_COUNTRIES.find((item) => item.id === id)?.name}</span>
            <strong>
              {formatCycleValue(value, series ? cycleDisplayUnit(series) : undefined)}
            </strong>
            <small>
              {point && series
                ? `${point.period} · ${frequencyLabel[series.frequency]} · ${adjustmentLabel[series.seasonalAdjustment]}${series.source.seriesCode.includes("derived-") ? " · 计算值" : ""}${age ? ` · 距截止 ${age} 个月` : ""}`
                : series
                  ? "所选截止前无有效数据"
                  : "该经济体暂未收录此指标"}
            </small>
          </div>
        );
      })}
    </div>
  );
}
function SeriesSource({ series }: { series: CycleSeries }) {
  const latest = [...series.observations].reverse().find((point) => point.value !== null);
  return (
    <article className="cycle-source-item">
      <header>
        <strong>
          {CYCLE_COUNTRIES.find((item) => item.id === series.country)?.name} ·{" "}
          {CYCLE_INDICATORS.find((item) => item.id === series.indicator)?.name}
        </strong>
        <span>
          {frequencyLabel[series.frequency]} · {unitLabel[series.unit]} ·{" "}
          {adjustmentLabel[series.seasonalAdjustment]}
        </span>
      </header>
      <p>{series.note}</p>
      <small>
        资源内最新观测 {latest?.period ?? "—"} · 抓取 {series.fetchedAt.slice(0, 10)} · 来源发布日期{" "}
        {series.sourceUpdatedAt?.slice(0, 10) ?? "未提供"}
      </small>
      <a href={series.source.url} target="_blank" rel="noopener noreferrer">
        {series.source.name} · {series.source.seriesCode}
        <ArrowUpRight size={12} />
      </a>
      {series.source.licenseUrl && (
        <a href={series.source.licenseUrl} target="_blank" rel="noopener noreferrer">
          数据许可与使用条款
          <ArrowUpRight size={12} />
        </a>
      )}
    </article>
  );
}
export function CycleData({
  snapshot,
  state,
  dialog,
  onClose,
}: {
  snapshot: CycleSnapshot;
  state: CycleViewState;
  dialog: "sources" | "table" | null;
  onClose: () => void;
}) {
  if (!dialog) return null;
  const indicator = CYCLE_INDICATORS.find((item) => item.id === state.metric)!;
  const selected = snapshot.series.filter((item) => state.countries.includes(item.country));
  return (
    <>
      <Dialog
        open={dialog === "sources"}
        onClose={onClose}
        title="周期数据 · 来源与覆盖"
        className="macro-data-dialog"
      >
        <p className="macro-caption">
          内置
          BIS、OECD、国家统计局和美国官方机构的真实观测，随项目打包。缺失保留为空，不使用模拟数据。抓取日期{" "}
          {snapshot.fetchedAt.slice(0, 10)}。
        </p>
        <p className="macro-caption">
          多数国际序列为当前修订版历史数据；中国实体指标按逐期官方发布提取，未构建完整实时版本。回放不代表当时已公布的信息。月度观察时间由
          CLI
          决定；下方趋势可独立选择该指标最新数据。日、周、月、季度各自保留原始期次；未披露的发布日期保留为空。
        </p>
        <p className="macro-caption">
          BIS 中文指标名称与说明为非官方翻译。派生指标会明确标记计算值，并在说明与 CSV
          中保留输入来源；不是机构直接发布或实时历史版本。
        </p>
        <div className="cycle-coverage-scroll">
          <table className="macro-data-table">
            <caption>已收录指标覆盖，— 表示当前资源未收录</caption>
            <thead>
              <tr>
                <th>指标</th>
                {state.countries.map((id) => (
                  <th key={id}>{CYCLE_COUNTRIES.find((country) => country.id === id)?.name}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {CYCLE_INDICATORS.filter((item) =>
                snapshot.series.some((series) => series.indicator === item.id),
              ).map((item) => (
                <tr key={item.id}>
                  <th scope="row">{item.name}</th>
                  {state.countries.map((id) => {
                    const source = getCycleSeries(snapshot, id, item.id);
                    return (
                      <td key={id}>
                        {source
                          ? ([...source.observations]
                              .reverse()
                              .find((point) => point.value !== null)?.period ?? "—")
                          : "—"}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="cycle-sources">
          {selected.map((series) => (
            <SeriesSource key={`${series.country}:${series.indicator}`} series={series} />
          ))}
        </div>
      </Dialog>
      <Dialog
        open={dialog === "table"}
        onClose={onClose}
        title={`${indicator.name} · 原始期次数据表`}
        className="macro-data-dialog"
      >
        <p className="macro-caption">
          {indicator.description} 展示截至 {cycleTrendEnd(snapshot, state)} 的观测；—
          为缺失。表内数值与曲线一致，导出 CSV 同时保留原始值及完整来源。
        </p>
        {cycleTableSeries(snapshot, state).map(({ series, points }) => (
          <div className="cycle-native-table" key={series.country}>
            <h3>
              {CYCLE_COUNTRIES.find((item) => item.id === series.country)?.name} ·{" "}
              {frequencyLabel[series.frequency]} · {adjustmentLabel[series.seasonalAdjustment]}
            </h3>
            <div
              className="macro-table-scroll"
              tabIndex={0}
              aria-label={`${series.country} 周期数据表`}
            >
              <table className="macro-data-table">
                <caption>
                  {series.source.name} · {unitLabel[cycleDisplayUnit(series)]} · A/P/E/B
                  等标记按来源保留
                </caption>
                <thead>
                  <tr>
                    <th scope="col">期次</th>
                    <th scope="col">图表数值</th>
                    <th scope="col">序列数值</th>
                    <th scope="col">原始单位</th>
                    <th scope="col">来源标记</th>
                  </tr>
                </thead>
                <tbody>
                  {[...points].reverse().map((point) => (
                    <tr key={point.period}>
                      <th scope="row">{point.period}</th>
                      <td>{formatCycleValue(point.value, cycleDisplayUnit(series))}</td>
                      <td>
                        {formatCycleValue(
                          series.observations.find((raw) => raw.period === point.period)?.value,
                        )}
                      </td>
                      <td>{unitLabel[series.unit]}</td>
                      <td>{point.status ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))}
        {!cycleTableSeries(snapshot, state).length && (
          <p className="macro-empty">所选经济体尚未收录此指标。</p>
        )}
      </Dialog>
    </>
  );
}
