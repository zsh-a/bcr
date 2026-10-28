import { lazy, Suspense, useEffect, useMemo, useState, useTransition } from "react";
import {
  Activity,
  ArrowDownToLine,
  Box,
  CircleHelp,
  Database,
  LayoutList,
  SlidersHorizontal,
} from "lucide-react";
import {
  Button,
  Dialog,
  Select,
  Spinner,
  useLocationSearch,
  useNavigation,
  useRuntimeActivity,
} from "@bcr/react";
import {
  bundledCycleSnapshot as snapshot,
  CYCLE_COUNTRIES,
  CYCLE_INDICATORS,
  cycleSpacePoints,
} from "@bcr/market-data/cycle";
import { CountryRail } from "../macro/CountryRail";
import { CycleCards, CyclePillars } from "./CycleCards";
import { CycleTimeline } from "./CycleTimeline";
import { SignalNavigator } from "./SignalNavigator";
import { CycleHealth } from "./CycleHealth";
import { CycleChart } from "./CycleChart";
import { CycleData, CycleReadout, cycleCsv } from "./CycleData";
import {
  cycleTrendEnd,
  cycleViewUrl,
  cycleWindowPeriods,
  parseCycleState,
  type CycleViewState,
} from "./state";
import { useCyclePalette } from "./useCyclePalette";
import "@fontsource-variable/newsreader";
import "../macro/styles.css";
import "./styles.css";
import "./signals.css";

const CycleSpace3D = lazy(() => import("./CycleSpace3D"));
export default function CycleView() {
  const search = useLocationSearch(),
    navigation = useNavigation(),
    active = useRuntimeActivity();
  const state = useMemo(() => parseCycleState(search, snapshot), [search]);
  const [pending, startTransition] = useTransition(),
    [playing, setPlaying] = useState(false);
  const [dialog, setDialog] = useState<"sources" | "table" | null>(null),
    [countryDialog, setCountryDialog] = useState(false);
  const palette = useCyclePalette();
  // Stable frame across months: all points in the selected window define the axes.
  const countryKey = state.countries.join(",");
  const periods = useMemo(
    () => cycleWindowPeriods(snapshot, countryKey.split(","), state.window),
    [countryKey, state.window],
  );
  const points = useMemo(
    () =>
      cycleSpacePoints(
        snapshot,
        countryKey.split(","),
        periods.at(-1) ?? "2026-09",
        periods.length,
      ),
    [countryKey, periods],
  );
  const sceneCountries = useMemo(
    () =>
      countryKey
        .split(",")
        .filter(Boolean)
        .map((id, index) => ({
          id,
          name: CYCLE_COUNTRIES.find((item) => item.id === id)?.name ?? id,
          color: palette.colors[index] ?? palette.text,
        })),
    [countryKey, palette],
  );
  const update = (patch: Partial<CycleViewState>, replace = false) =>
    startTransition(() =>
      navigation.navigate(cycleViewUrl({ ...state, ...patch }, search), replace),
    );
  const focus = (country: string) => update({ focus: country }, true);
  const changeCountries = (countries: string[]) => {
    setPlaying(false);
    update({
      countries,
      focus: countries.includes(state.focus ?? "") ? state.focus : (countries[0] ?? null),
    });
  };
  const metrics = CYCLE_INDICATORS.filter(
    (item) =>
      snapshot.series.some(
        (series) => series.indicator === item.id && state.countries.includes(series.country),
      ) || item.id === state.metric,
  );
  const metric = CYCLE_INDICATORS.find((item) => item.id === state.metric)!;
  const currentIndex = Math.max(0, periods.indexOf(state.period));
  useEffect(() => {
    if (!active) {
      setPlaying(false);
      setDialog(null);
      setCountryDialog(false);
    }
  }, [active]);
  useEffect(() => {
    if (!playing || !active) return;
    const timer = window.setTimeout(() => {
      const next = periods[currentIndex + 1];
      if (!next || document.visibilityState !== "visible") {
        setPlaying(false);
        return;
      }
      navigation.navigate(cycleViewUrl({ ...state, period: next, asOf: "period" }, search), true);
    }, 1100);
    return () => window.clearTimeout(timer);
  }, [playing, active, currentIndex, periods, state, navigation, search]);
  const exportData = () => {
    const url = URL.createObjectURL(
        new Blob([cycleCsv(snapshot, state)], { type: "text/csv;charset=utf-8" }),
      ),
      anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `cycle-${state.metric}-${cycleTrendEnd(snapshot, state)}.csv`;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <div
      className="macro-atlas cycle-atlas"
      aria-busy={pending}
      data-period={state.period}
      data-mode={state.mode}
    >
      <aside className="macro-sidebar">
        <div className="macro-rail-brand">
          <Activity size={20} />
          <span>
            CYCLE OBSERVATORY<small>经济周期 · 月度坐标</small>
          </span>
        </div>
        <CountryRail
          maxSelected={5}
          countries={CYCLE_COUNTRIES}
          selected={state.countries}
          onChange={changeCountries}
        />
        <div className="macro-rail-foot">
          <Database size={16} />
          <p>
            周期数据已随项目打包<small>五国领先景气 · 官方实体指标</small>
          </p>
        </div>
      </aside>
      <div className="macro-main">
        <header className="macro-page-heading">
          <div>
            <span className="macro-eyebrow">THE RHYTHM OF THE ECONOMY</span>
            <h1>
              经济周期监测<span>Cycle Observatory</span>
            </h1>
            <p>先看领先信号，再用生产、需求与就业交叉验证。</p>
          </div>
          <div className="macro-page-actions">
            <Button className="macro-country-trigger" onClick={() => setCountryDialog(true)}>
              <SlidersHorizontal size={15} />
              选择经济体
            </Button>
            <Button variant="ghost" onClick={() => setDialog("sources")}>
              <CircleHelp size={15} />
              周期数据说明
            </Button>
            <Button onClick={exportData}>
              <ArrowDownToLine size={15} />
              导出周期 CSV
            </Button>
          </div>
        </header>
        <div className="macro-data-status">
          <span>
            <span className="macro-status-dot" />
            内置官方数据资源
          </span>
          <span>
            月度观察 {state.period} · 资源抓取 {snapshot.fetchedAt.slice(0, 10)}
          </span>
          <span>历史值可能修订 · 口径逐序列注明</span>
        </div>
        {!state.countries.length ? (
          <p className="macro-notice">
            当前链接中的经济体尚无周期数据，请选择中国、美国、日本、德国或英国。全球年度比较仍可在“长期比较”中查看。
          </p>
        ) : (
          <>
            <CycleCards
              snapshot={snapshot}
              countries={state.countries}
              period={state.period}
              focus={state.focus}
              onFocus={focus}
            />
            <section className="macro-chart-panel cycle-space-panel" aria-label="领先景气周期空间">
              <div className="macro-chart-heading">
                <div>
                  <span className="macro-eyebrow">LEADING CYCLE · A SHARED FRAME</span>
                  <h2>
                    周期的位置与方向<span>CLI 水平 × 三个月变化</span>
                  </h2>
                </div>
                <div className="macro-view-switch" aria-label="周期空间展示方式">
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-pressed={state.mode === "2d"}
                    onClick={() => update({ mode: "2d" })}
                  >
                    二维相位
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-pressed={state.mode === "3d"}
                    onClick={() => update({ mode: "3d" })}
                  >
                    <Box size={14} />
                    三维周期空间
                  </Button>
                </div>
              </div>
              <div className="cycle-phase-toolbar">
                <span>100 = 长期趋势 · Δ3M = 本月 − 三个月前</span>
                <label>
                  回放窗口
                  <Select
                    aria-label="周期回放窗口"
                    value={state.window}
                    onChange={(event) => {
                      setPlaying(false);
                      update({ window: event.target.value as CycleViewState["window"] });
                    }}
                  >
                    <option value="5y">近 5 年</option>
                    <option value="10y">近 10 年</option>
                    <option value="all">2000 年至今</option>
                  </Select>
                </label>
              </div>
              {state.mode === "2d" ? (
                <CycleChart
                  snapshot={snapshot}
                  state={state}
                  palette={palette}
                  points={points}
                  kind="phase"
                  onSelect={focus}
                />
              ) : (
                <Suspense
                  fallback={
                    <div className="cycle-space-loading" role="status">
                      <Spinner size="sm" />
                      正在加载三维周期空间…
                    </div>
                  }
                >
                  <CycleSpace3D
                    points={points}
                    countries={sceneCountries}
                    period={state.period}
                    selectedCountry={state.focus}
                    onSelectCountry={focus}
                    active={active}
                  />
                </Suspense>
              )}
              <CycleTimeline
                state={state}
                periods={periods}
                playing={playing}
                onPlaying={setPlaying}
                onUpdate={update}
              />
              <div className="cycle-phase-key">
                <span>高于趋势 · 改善</span>
                <span>高于趋势 · 放缓</span>
                <span>低于趋势 · 走弱</span>
                <span>低于趋势 · 修复</span>
              </div>
              <footer className="macro-chart-source">
                <span>
                  {state.mode === "3d"
                    ? "纵深为历史月份，轨迹保留最近 36 个月。拖动旋转、滚轮缩放；可用上方国家卡片选择。"
                    : "淡线展示最近 12 个月轨迹，坐标范围在回放窗口内固定。点击国家查看分项。"}{" "}
                  CLI 描述相对趋势的领先景气，不是衰退判定。
                </span>
              </footer>
            </section>
            <div className="cycle-section-heading">
              <span className="macro-eyebrow">CHECK THE REAL ECONOMY</span>
              <h2>
                {CYCLE_COUNTRIES.find((item) => item.id === state.focus)?.name ?? "所选经济体"} ·
                周期分项
              </h2>
            </div>
            <CyclePillars snapshot={snapshot} country={state.focus} period={state.period} />
            <section className="macro-chart-panel cycle-trend-panel" aria-label="周期指标趋势比较">
              <div className="macro-chart-heading">
                <h2>从信号到验证</h2>
                <label className="cycle-metric-label">
                  观察指标
                  <Select
                    aria-label="周期趋势指标"
                    value={state.metric}
                    onChange={(event) =>
                      update({ metric: event.target.value as CycleViewState["metric"] })
                    }
                  >
                    {metrics.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                  </Select>
                </label>
              </div>
              <SignalNavigator
                snapshot={snapshot}
                countries={state.countries}
                metric={state.metric}
                onSelect={(metric) => update({ metric, asOf: "latest" })}
              />
              <div className="cycle-trend-cutoff">
                <p className="cycle-description">{metric.description}</p>
                <label>
                  趋势截止
                  <Select
                    aria-label="周期趋势截止方式"
                    value={state.asOf}
                    onChange={(event) =>
                      update({ asOf: event.target.value as CycleViewState["asOf"] })
                    }
                  >
                    <option value="period">所选观察月</option>
                    <option value="latest">该指标最新数据</option>
                  </Select>
                </label>
              </div>
              <CycleReadout snapshot={snapshot} state={state} />
              <CycleChart
                snapshot={snapshot}
                state={state}
                palette={palette}
                points={points}
                kind="trend"
                onSelect={focus}
              />
              <CycleHealth snapshot={snapshot} state={state} />
              <footer className="macro-chart-source">
                <span>
                  趋势截至 {cycleTrendEnd(snapshot, state)}
                  。原始统计频率保留；指数类活动指标按同月同比展示，季度 GDP
                  同比与美国折年率分开。缺口不插值。
                </span>
                <Button variant="ghost" size="sm" onClick={() => setDialog("table")}>
                  <LayoutList size={14} />
                  查看周期数据表
                </Button>
              </footer>
            </section>
            <p className="cycle-method-note">
              领先信号、实体活动和金融条件可能背离。中国社零保留名义口径，房地产部分指标为累计同比；各国调查范围和利率工具不完全相同。历史版本和修订情况见来源说明，回放不能作为无前视偏差的交易回测。
            </p>
          </>
        )}
        <footer className="macro-page-footer">
          <span>BIS · OECD · NBS · FED / BLS / BEA / CENSUS / DOL · BUNDLED OBSERVATIONS</span>
          <Button size="sm" variant="ghost" onClick={() => setDialog("sources")}>
            来源与统计口径
          </Button>
        </footer>
      </div>
      <Dialog
        open={active && countryDialog}
        onClose={() => setCountryDialog(false)}
        title="选择周期比较经济体"
        className="macro-country-dialog"
      >
        <CountryRail
          maxSelected={5}
          countries={CYCLE_COUNTRIES}
          selected={state.countries}
          onChange={changeCountries}
        />
        <Button variant="primary" onClick={() => setCountryDialog(false)}>
          完成选择
        </Button>
      </Dialog>
      <CycleData
        snapshot={snapshot}
        state={state}
        dialog={active ? dialog : null}
        onClose={() => setDialog(null)}
      />
    </div>
  );
}
