import { useEffect, useMemo, useState, useTransition } from "react";
import {
  ArrowDownToLine,
  CircleHelp,
  Database,
  Landmark,
  LayoutList,
  SlidersHorizontal,
} from "lucide-react";
import {
  Button,
  Dialog,
  Select,
  useLocationSearch,
  useNavigation,
  useRuntimeActivity,
} from "@bcr/react";
import {
  bundledDebtSnapshot as snapshot,
  DEBT_BIS_TRANSLATION_NOTE,
  DEBT_COUNTRIES,
  DEBT_FREQUENCY_LABELS,
  DEBT_INDICATORS,
  debtChartObservations,
  debtExact,
  debtLatest,
  debtPhasePoints,
  formatDebtValue,
  getDebtSeries,
} from "@bcr/market-data/debt";
import { CountryRail } from "../macro/CountryRail";
import { useCyclePalette } from "../cycle/useCyclePalette";
import { DebtCards, DebtPillars } from "./DebtCards";
import { DebtChart } from "./DebtChart";
import { DebtData } from "./DebtData";
import { debtCsv } from "./export";
import {
  debtReadingIsOld,
  debtStateUrl,
  debtStatusLabel,
  debtTrendEnd,
  debtVisibleObservations,
  debtWindowQuarters,
  parseDebtState,
  type DebtViewState,
} from "./state";
import "@fontsource-variable/newsreader";
import "../macro/styles.css";
import "./styles.css";

export default function DebtView() {
  const search = useLocationSearch(),
    navigation = useNavigation(),
    active = useRuntimeActivity();
  const state = useMemo(() => parseDebtState(search, snapshot), [search]);
  const [pending, startTransition] = useTransition(),
    [dialog, setDialog] = useState<"sources" | "table" | null>(null),
    [countryDialog, setCountryDialog] = useState(false);
  const palette = useCyclePalette(),
    countryKey = state.countries.join(",");
  const quarters = useMemo(
    () => debtWindowQuarters(snapshot, countryKey.split(","), state.window),
    [countryKey, state.window],
  );
  const countries = useMemo(
    () =>
      countryKey
        .split(",")
        .filter(Boolean)
        .map((id, index) => ({
          id,
          name: DEBT_COUNTRIES.find((country) => country.id === id)?.name ?? id,
          color: palette.colors[index] ?? palette.text,
        })),
    [countryKey, palette],
  );
  const phasePoints = useMemo(
    () => debtPhasePoints(snapshot, countryKey.split(","), quarters),
    [countryKey, quarters],
  );
  const structure = state.countries.map((country) => ({
    country,
    name: DEBT_COUNTRIES.find((item) => item.id === country)?.name ?? country,
    household: debtExact(getDebtSeries(snapshot, country, "householdDebt"), state.quarter),
    corporate: debtExact(getDebtSeries(snapshot, country, "corporateDebt"), state.quarter),
    government: debtExact(getDebtSeries(snapshot, country, "governmentDebt"), state.quarter),
  }));
  const end = debtTrendEnd(snapshot, state);
  const currencies = new Set(
    state.countries
      .map((id) => getDebtSeries(snapshot, id, state.metric)?.currency)
      .filter(Boolean),
  );
  const mixedCurrencies = currencies.size > 1;
  const trendSeries = state.countries.flatMap((id, index) => {
    if (mixedCurrencies && id !== state.focus) return [];
    const series = getDebtSeries(snapshot, id, state.metric);
    return series
      ? [
          {
            id,
            name: DEBT_COUNTRIES.find((country) => country.id === id)?.name ?? id,
            color: palette.colors[index] ?? palette.text,
            unit: series.unit,
            frequency: series.frequency,
            points: debtVisibleObservations(
              { ...series, observations: debtChartObservations(series) },
              end,
              state.window,
            ),
          },
        ]
      : [];
  });
  const metrics = DEBT_INDICATORS.filter(
    (indicator) =>
      snapshot.series.some(
        (series) => series.indicator === indicator.id && state.countries.includes(series.country),
      ) || indicator.id === state.metric,
  );
  const metric = DEBT_INDICATORS.find((indicator) => indicator.id === state.metric)!;
  const update = (patch: Partial<DebtViewState>, replace = false) =>
    startTransition(() =>
      navigation.navigate(debtStateUrl({ ...state, ...patch }, search), replace),
    );
  const focus = (country: string) => update({ focus: country }, true);
  const changeCountries = (selected: string[]) =>
    update({
      countries: selected,
      focus: selected.includes(state.focus ?? "") ? state.focus : (selected[0] ?? null),
    });
  useEffect(() => {
    if (!active) {
      setDialog(null);
      setCountryDialog(false);
    }
  }, [active]);
  const exportData = () => {
    const url = URL.createObjectURL(
        new Blob([debtCsv(snapshot, state)], { type: "text/csv;charset=utf-8" }),
      ),
      anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `debt-${state.metric}-${end}.csv`;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const chartProps = {
    palette,
    countries,
    period: state.quarter,
    focus: state.focus,
    onSelect: focus,
    trendSeries,
    structure,
    phasePoints,
  };
  const absentPhase = state.countries.filter(
    (country) =>
      !phasePoints.some((point) => point.country === country && point.period === state.quarter),
  );
  return (
    <div
      className="macro-atlas debt-atlas"
      aria-busy={pending}
      data-quarter={state.quarter}
      data-mode={state.mode}
      data-metric={state.metric}
    >
      <aside className="macro-sidebar">
        <div className="macro-rail-brand">
          <Landmark size={20} />
          <span>
            CREDIT & LEVERAGE<small>债务结构 · 信用周期</small>
          </span>
        </div>
        <CountryRail
          maxSelected={5}
          countries={DEBT_COUNTRIES}
          selected={state.countries}
          onChange={changeCountries}
        />
        <div className="macro-rail-foot">
          <Database size={16} />
          <p>
            债务数据已随项目打包<small>官方观测 · 按原始频率展示</small>
          </p>
        </div>
      </aside>
      <div className="macro-main">
        <header className="macro-page-heading">
          <div>
            <span className="macro-eyebrow">THE BALANCE SHEET OF AN ECONOMY</span>
            <h1>
              债务与信用周期<span>Credit & Leverage</span>
            </h1>
            <p>观察杠杆在哪里累积，新增融资如何变化，收入能否承担偿债。</p>
          </div>
          <div className="macro-page-actions">
            <Button className="macro-country-trigger" onClick={() => setCountryDialog(true)}>
              <SlidersHorizontal size={15} />
              选择经济体
            </Button>
            <Button variant="ghost" onClick={() => setDialog("sources")}>
              <CircleHelp size={15} />
              债务数据说明
            </Button>
            <Button onClick={exportData}>
              <ArrowDownToLine size={15} />
              导出债务 CSV
            </Button>
          </div>
        </header>
        <div className="macro-data-status">
          <span>
            <span className="macro-status-dot" />
            内置官方债务与融资资源
          </span>
          <span>
            季度比较 {state.quarter} · 抓取 {snapshot.fetchedAt.slice(0, 10)}
          </span>
          <span>当前修订版历史值</span>
        </div>
        {!state.countries.length ? (
          <p className="macro-notice">
            当前经济体尚未收录债务数据，请选择中国、美国、日本、德国或英国。
          </p>
        ) : (
          <>
            <DebtCards snapshot={snapshot} state={state} onSelect={focus} />
            <section
              className="macro-chart-panel debt-comparison-panel"
              aria-label="债务结构与信用相位"
            >
              <div className="macro-chart-heading">
                <div>
                  <span className="macro-eyebrow">LEVERAGE · PRESSURE · DIRECTION</span>
                  <h2>
                    {state.mode === "structure" ? "部门杠杆结构" : "信用偏离与偿债压力"}
                    <span>{state.quarter} · 季度</span>
                  </h2>
                </div>
                <div className="macro-view-switch" aria-label="债务图表展示方式">
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-pressed={state.mode === "structure"}
                    onClick={() => update({ mode: "structure" })}
                  >
                    部门比较
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-pressed={state.mode === "phase"}
                    onClick={() => update({ mode: "phase" })}
                  >
                    信用相位
                  </Button>
                </div>
              </div>
              <div className="debt-chart-controls">
                <p>
                  {state.mode === "structure"
                    ? "按部门并列展示核心债务占 GDP 比重，不将不同口径直接堆成总量。"
                    : "横轴为 BIS 信贷 / GDP 缺口；纵轴为 DSR 相对本国前 40 季均值的偏离。"}
                </p>
                <label>
                  比较窗口
                  <Select
                    aria-label="债务比较窗口"
                    value={state.window}
                    onChange={(event) =>
                      update({ window: event.target.value as DebtViewState["window"] })
                    }
                  >
                    <option value="5y">近 5 年</option>
                    <option value="10y">近 10 年</option>
                    <option value="all">完整历史</option>
                  </Select>
                </label>
              </div>
              <DebtChart {...chartProps} kind={state.mode} />
              {state.mode === "phase" && absentPhase.length > 0 && (
                <p className="macro-missing-note">
                  {absentPhase
                    .map((country) => DEBT_COUNTRIES.find((item) => item.id === country)?.name)
                    .join("、")}{" "}
                  缺少当季指标或连续 40 季历史，未绘制当季点。
                </p>
              )}
              <div className="debt-quarter-control">
                <label htmlFor="debt-quarter-slider">{state.quarter}</label>
                <input
                  id="debt-quarter-slider"
                  type="range"
                  aria-label="债务观察季度"
                  min={0}
                  max={Math.max(0, quarters.length - 1)}
                  value={Math.max(0, quarters.indexOf(state.quarter))}
                  onChange={(event) => {
                    const quarter = quarters[Number(event.target.value)];
                    if (quarter) update({ quarter, asOf: "quarter" }, true);
                  }}
                />
                <Select
                  aria-label="精确选择债务季度"
                  value={state.quarter}
                  onChange={(event) =>
                    update({ quarter: event.target.value, asOf: "quarter" }, true)
                  }
                >
                  {quarters.map((quarter) => (
                    <option key={quarter}>{quarter}</option>
                  ))}
                </Select>
              </div>
              <footer className="macro-chart-source">
                <span>
                  {state.mode === "structure"
                    ? "企业包括公营及私营非金融企业。政府优先名义估值；居民、企业保留 BIS 原口径。缺失不按零处理。"
                    : "淡线为此前 12 季轨迹，坐标范围在窗口内固定。零线仅为描述基准，不能用象限推断危机概率或当季衰退。"}
                </span>
              </footer>
            </section>
            <div className="debt-section-heading">
              <span className="macro-eyebrow">READ THE SECTORS</span>
              <h2>
                {DEBT_COUNTRIES.find((item) => item.id === state.focus)?.name ?? "所选经济体"} ·
                杠杆与偿债
              </h2>
            </div>
            <DebtPillars snapshot={snapshot} state={state} />
            <section className="macro-chart-panel debt-trend-panel" aria-label="债务与融资趋势">
              <div className="macro-chart-heading">
                <h2>从存量到融资变化</h2>
                <label className="debt-metric-label">
                  观察指标
                  <Select
                    aria-label="债务趋势指标"
                    value={state.metric}
                    onChange={(event) =>
                      update({ metric: event.target.value as DebtViewState["metric"] })
                    }
                  >
                    {metrics.map((indicator) => (
                      <option key={indicator.id} value={indicator.id}>
                        {indicator.name}
                      </option>
                    ))}
                  </Select>
                </label>
              </div>
              <div className="debt-chart-controls">
                <p>
                  {metric.description}
                  {mixedCurrencies ? " 本币金额仅绘制当前聚焦国家，不跨币种比较。" : ""}
                </p>
                <label>
                  趋势截止
                  <Select
                    aria-label="债务趋势截止方式"
                    value={state.asOf}
                    onChange={(event) =>
                      update({ asOf: event.target.value as DebtViewState["asOf"] })
                    }
                  >
                    <option value="latest">该指标最新数据</option>
                    <option value="quarter">所选季度末</option>
                  </Select>
                </label>
              </div>
              <div className="debt-readouts" aria-label="债务指标当前读数">
                {state.countries.map((country) => {
                  const series = getDebtSeries(snapshot, country, state.metric),
                    point = debtLatest(series, end);
                  return (
                    <div key={country}>
                      <span>{DEBT_COUNTRIES.find((item) => item.id === country)?.name}</span>
                      <strong>
                        {formatDebtValue(point?.value, series?.unit, series?.currency)}
                      </strong>
                      <small>
                        {series && point
                          ? `${point.period} · ${DEBT_FREQUENCY_LABELS[series.frequency]}${debtStatusLabel(point.status) ? ` · ${debtStatusLabel(point.status)}` : ""}${debtReadingIsOld(series, point.period, state.asOf === "latest" ? snapshot.fetchedAt.slice(0, 7) : end) ? " · 观测期较早" : ""}`
                          : "该经济体暂未收录此指标"}
                      </small>
                    </div>
                  );
                })}
              </div>
              <DebtChart {...chartProps} kind="trend" />
              <footer className="macro-chart-source">
                <span>
                  趋势截至 {end}
                  ，与上方季度比较分别标明。月度社融保留季节性；年度财政数据保留估计状态。原始期次与精度可导出。
                </span>
                <Button size="sm" variant="ghost" onClick={() => setDialog("table")}>
                  <LayoutList size={14} />
                  查看债务数据表
                </Button>
              </footer>
            </section>
            <p className="debt-method-note">
              债务 / GDP 同时受借款与名义 GDP 变化影响。DSR
              用于观察本国历史压力，不按绝对值给国家排名。中国社融包含股权和政府债券，不能等同纯债务或与其中的政府债券重复相加。
            </p>
          </>
        )}
        <footer className="macro-page-footer">
          <span>{DEBT_BIS_TRANSLATION_NOTE}</span>
          <Button size="sm" variant="ghost" onClick={() => setDialog("sources")}>
            来源与覆盖
          </Button>
        </footer>
      </div>
      <Dialog
        open={active && countryDialog}
        onClose={() => setCountryDialog(false)}
        title="选择债务比较经济体"
        className="macro-country-dialog"
      >
        <CountryRail
          maxSelected={5}
          countries={DEBT_COUNTRIES}
          selected={state.countries}
          onChange={changeCountries}
        />
        <Button variant="primary" onClick={() => setCountryDialog(false)}>
          完成选择
        </Button>
      </Dialog>
      <DebtData
        snapshot={snapshot}
        state={state}
        dialog={active ? dialog : null}
        onClose={() => setDialog(null)}
      />
    </div>
  );
}
