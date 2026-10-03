import { DAY, utcDate } from "@bcr/market-data/binance/model";
import {
  TREND_REASONS,
  trendRunView,
  periodLabel,
  trendEntryEvidence,
  type TrendResult as Result,
  type TrendRun,
  type TrendTrade,
} from "@bcr/quant-core/trend";
import { Button, PanelEmpty, Spinner, useRuntime } from "@bcr/react";
import { ChevronLeft, ChevronRight, Download } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { TrendChart } from "./TrendChart";
import { exportTrend, readTradePage } from "./read";
import { useTrendChart } from "./useTrendChart";
import { TrendContextPanel } from "./TrendContextPanel";
import { trendEntryFields } from "./entry";
import { number, timestamp } from "./evaluation";
import { TrendEvaluationPanel, TrendMonthlyReturns } from "./TrendEvaluationPanel";
import { TrendPerformanceChart } from "./TrendPerformanceChart";

export function TrendResult({ run, result }: { run: TrendRun; result: Result }) {
  const services = useRuntime();
  const config = useMemo(() => trendRunView(run), [run]);
  const chartFrame = useRef<HTMLDivElement>(null);
  const m = result.metrics,
    manifest = run.dataset.manifest;
  const evaluationWindow = result.window ?? manifest;
  const [view, setView] = useState<"equity" | "candles" | "context">("equity");
  const chart = useTrendChart(
    services,
    run.dataset,
    result,
    config.tradeMinutes,
    view === "candles",
    config.channelConfig,
  );
  const [focusedTrade, setFocusedTrade] = useState<TrendTrade | null>(null);
  const evidence = focusedTrade
    ? trendEntryEvidence(focusedTrade, config.channelConfig, chart.data)
    : undefined;
  const [page, setPage] = useState(0),
    [trades, setTrades] = useState<TrendTrade[] | null>(null);
  const [error, setError] = useState<string | null>(null),
    [exporting, setExporting] = useState(false);
  useEffect(() => {
    setTrades(null);
    const abort = new AbortController();
    void readTradePage(services, result, page, 20, abort.signal)
      .then(setTrades)
      .catch((e) => {
        if (!abort.signal.aborted) setError(String(e));
      });
    return () => abort.abort();
  }, [services, result, page]);
  const events = chart.data?.events ?? [];
  return (
    <div className="trend-result">
      <div className="trend-result-heading">
        <div>
          <h2>
            {manifest.symbol} · {periodLabel(config.tradeMinutes)} · {config.label}
          </h2>
          <p>
            {utcDate(evaluationWindow.startTime)} — {utcDate(evaluationWindow.endTime - 1)} · UTC ·{" "}
            {config.filter} ·{" "}
            {config.archived ? "原始旧版规则 · " : `规则 v${config.ruleVersion} · `}
            {config.direction} · {config.management} · 运算耗时 {number(run.durationMs / 1000, 1)}{" "}
            秒{" · "}
            {config.costFilter}
            {run.cached ? " · 缓存结果" : ""}
          </p>
        </div>
        <Button
          size="sm"
          disabled={exporting}
          onClick={() => {
            setExporting(true);
            void exportTrend(services, run, result)
              .catch((e) => setError(String(e)))
              .finally(() => setExporting(false));
          }}
        >
          <Download size={15} />
          导出完整结果
        </Button>
      </div>
      {config.entry === "kdj" && (
        <p className="trend-help">
          KDJ 回调研究 · 截图推测方案，不是博主规则的精确复现；当前结果仅代表这组明确规则的回放。
        </p>
      )}
      <TrendEvaluationPanel metrics={m} window={evaluationWindow} />
      {(error || chart.error) && (
        <p role="alert" className="trend-error">
          {error || chart.error}
          {chart.error && (
            <Button variant="ghost" size="sm" onClick={chart.retry}>
              重试加载
            </Button>
          )}
        </p>
      )}
      <div className="trend-chart-toolbar">
        <div className="trend-view-tabs" role="group" aria-label="结果图表">
          <Button
            size="sm"
            variant={view === "equity" ? "default" : "ghost"}
            aria-pressed={view === "equity"}
            onClick={() => setView("equity")}
          >
            净值
          </Button>
          <Button
            size="sm"
            variant={view === "candles" ? "default" : "ghost"}
            aria-pressed={view === "candles"}
            onClick={() => setView("candles")}
          >
            K 线与买卖点
          </Button>
          {config.backgroundMinutes !== null && (
            <Button
              size="sm"
              variant={view === "context" ? "default" : "ghost"}
              aria-pressed={view === "context"}
              onClick={() => setView("context")}
            >
              入场背景
            </Button>
          )}
        </div>
        {view === "candles" ? (
          <div className="trend-chart-actions">
            <span className="trend-help">
              {periodLabel(chart.data?.minutes ?? config.tradeMinutes)} K 线
            </span>
            <Button size="sm" variant="ghost" onClick={chart.all}>
              全区间
            </Button>
            <Button size="sm" variant="ghost" onClick={chart.latest}>
              最新
            </Button>
          </div>
        ) : view === "equity" ? (
          <span className="trend-help">
            {m.evaluation?.version === 2
              ? "完整日序列 · 标记价格估值"
              : "历史抽样净值 · 标记价格估值"}
          </span>
        ) : null}
      </div>
      {view === "context" && config.backgroundMinutes !== null ? (
        <TrendContextPanel
          result={result}
          minutes={config.backgroundMinutes}
          onLocate={(time) => {
            chart.locate(time);
            setView("candles");
          }}
        />
      ) : view === "equity" ? (
        <>
          <TrendPerformanceChart
            result={result}
            initialCapital={config.initialCapital}
            window={evaluationWindow}
          />
          <TrendMonthlyReturns metrics={m} window={evaluationWindow} />
        </>
      ) : (
        <div ref={chartFrame} className="trend-chart-frame" aria-busy={chart.loading}>
          <TrendChart
            data={chart.data}
            config={config}
            bounds={chart.bounds}
            focus={chart.focus}
            onVisible={chart.visible}
          />
          {chart.loading && (
            <div className="trend-chart-status" role="status">
              <Spinner size="sm" />
              正在加载行情…
            </div>
          )}
        </div>
      )}
      {view === "candles" && (
        <>
          <div className="trend-chart-legend" aria-label="图表图例">
            {config.slowEma && <span>EMA 60 · 交易 K 线收盘值</span>}
            {config.entry === "kdj" && <span>K / D / J · 9,3,3 · 下方面板</span>}
            {config.channelConfig && (
              <span className="trend-legend-entry">
                此前 {config.channelConfig.entryBars} 根入场通道
              </span>
            )}
            {config.channelConfig?.exitBars && (
              <span className="trend-legend-exit">
                此前 {config.channelConfig.exitBars} 根退出通道
              </span>
            )}
            <span className="trend-legend-stop">持仓止损 · 分笔绘制</span>
          </div>
          <p className="trend-help">
            拖动浏览连续行情，滚轮或双指缩放；大区间自动合并显示 K 线，交易规则仍按{" "}
            {periodLabel(config.tradeMinutes)} 执行。箭头为多空入场，圆点为平仓；止损虚线按显示 K
            线开盘采样，空仓断开。
            {config.channelConfig &&
              "通道使用当根开盘前已完成的交易 K 线；合并显示时取显示 K 线开盘的已知边界。"}
            {config.filter}。
          </p>
          {focusedTrade && (
            <section className="trend-entry-detail" aria-label={`交易 ${focusedTrade.id} 入场依据`}>
              <div className="trend-entry-detail-heading">
                <strong>交易 {focusedTrade.id} · 入场依据</strong>
                <Button variant="ghost" size="sm" onClick={() => setFocusedTrade(null)}>
                  关闭入场依据
                </Button>
              </div>
              {evidence ? (
                <>
                  <p>
                    {evidence.source === "recorded"
                      ? evidence.trigger?.kind === "kdj-cross"
                        ? "KDJ 交叉 · 信号时冻结的记录"
                        : evidence.trigger?.kind === "structured-pullback"
                          ? "结构化回调 · 整段推进极值突破 · 信号时冻结的记录"
                          : evidence.trigger?.kind === "price-action"
                            ? "价格行为 · 整段推进极值突破 · 信号时冻结的记录"
                            : "信号时冻结的记录"
                      : "根据冻结行情计算的历史通道参考"}{" "}
                    · {timestamp(evidence.time)} UTC
                  </p>
                  <dl>
                    {trendEntryFields(evidence, focusedTrade, config.tickSize).map((field) => (
                      <div key={field.label}>
                        <dt>{field.label}</dt>
                        <dd>{field.value}</dd>
                      </div>
                    ))}
                  </dl>
                  <p className="trend-help">
                    {config.filter} · {config.costFilter}。
                    {config.priceAction &&
                      `关键位回踩${config.priceAction.keyLevel ? "必需" : "不设门槛"}，两腿回调${config.priceAction.twoLegs ? "必需" : "不设门槛"}；依据仅取本次冻结快照。`}
                    {config.structuredPullback &&
                      "关键位、各结构标签与转折确认时刻仅取本次冻结快照；未记录的形态不从后续行情补画。"}
                    {evidence.source === "derived" &&
                      "该旧记录未保存原始信号 ATR，此处仅核对通道和收盘价。"}
                  </p>
                </>
              ) : (
                <p className="trend-help">
                  该旧结果未保存入场快照。
                  {chart.loading
                    ? "正在读取交易附近的冻结行情…"
                    : config.channelConfig
                      ? "缩小至交易周期可核对通道参考。"
                      : "可结合信号事件和入场背景核对。"}
                </p>
              )}
            </section>
          )}
          <details className="trend-event-list">
            <summary>
              已加载区间的信号与风控 · {chart.data?.totalEvents ?? 0}
              {(chart.data?.totalEvents ?? 0) > events.length ? ` · 最近 ${events.length} 条` : ""}
            </summary>
            {events.length ? (
              events.map((e, i) => (
                <p key={i}>
                  <time>{timestamp(e.time)}</time>
                  <span>{TREND_REASONS[e.reason] ?? e.reason}</span>
                  <span>
                    {e.side === "long" ? "多" : "空"} · {number(e.price)}
                    {e.kind === "stage" && e.value !== null ? ` · 收盘 ${number(e.value)} R` : ""}
                  </span>
                </p>
              ))
            ) : (
              <p>图中区间没有信号或交易事件。</p>
            )}
          </details>
        </>
      )}
      <div className="trend-table-toolbar">
        <h3>
          交易明细 <span>{m.trades}</span>
        </h3>
        <span className="trend-help">点击交易定位买卖点 · 时间为 UTC</span>
      </div>
      {!m.trades ? (
        <PanelEmpty
          title="区间内没有成交"
          hint={
            config.backgroundMinutes !== null
              ? "可查看入场背景的拒绝原因，或选择无过滤基线对照。"
              : "可查看 K 线中的信号，或切换入场规则对照。"
          }
        />
      ) : (
        <>
          <div className="trend-table-scroll">
            <table>
              <thead>
                <tr>
                  {[
                    "入场时间",
                    "方向",
                    "入场 / 出场",
                    "数量",
                    "净盈亏 · USDT",
                    "净 R",
                    "退出原因",
                  ].map((h) => (
                    <th key={h}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {trades?.map((trade) => (
                  <tr key={trade.id}>
                    <td>
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={`查看交易 ${trade.id}`}
                        onClick={() => {
                          setFocusedTrade(trade);
                          chart.locate(trade.entryTime);
                          setView("candles");
                          requestAnimationFrame(() =>
                            chartFrame.current?.scrollIntoView({ block: "center" }),
                          );
                        }}
                      >
                        {timestamp(trade.entryTime)}
                      </Button>
                    </td>
                    <td>{trade.side === "long" ? "多" : "空"}</td>
                    <td>
                      {number(trade.entryPrice)} / {number(trade.exitPrice)}
                    </td>
                    <td>{number(trade.quantity, 4)}</td>
                    <td data-positive={trade.netPnl >= 0}>{number(trade.netPnl)}</td>
                    <td>{number(trade.rMultiple)}</td>
                    <td>{TREND_REASONS[trade.reason] ?? trade.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!trades && <Spinner />}
          </div>
          <div className="trend-pagination">
            <span>
              {page + 1} / {Math.ceil(m.trades / 20)}
            </span>
            <Button
              size="sm"
              aria-label="上一页交易"
              disabled={page === 0}
              onClick={() => setPage(page - 1)}
            >
              <ChevronLeft size={15} />
            </Button>
            <Button
              size="sm"
              aria-label="下一页交易"
              disabled={(page + 1) * 20 >= m.trades}
              onClick={() => setPage(page + 1)}
            >
              <ChevronRight size={15} />
            </Button>
          </div>
        </>
      )}
      <details className="trend-provenance">
        <summary>数据来源与执行口径</summary>
        {config.backgroundMinutes !== null && (
          <p>
            <>
              背景使用已收盘的{periodLabel(config.backgroundMinutes)} K 线，摆动点延后两根确认。
              只约束新开仓，逐信号的背景快照和判断均随完整结果导出。
            </>
          </p>
        )}
        <p>
          Binance 官方 USDT 永续历史档案，逐个 ZIP 验证
          SHA-256；一分钟成交价、标记价格及历史资金费率均被冻结保存。资金费以结算所在分钟的开盘标记价格近似计算，先结算原持仓，再执行新订单。
        </p>
        <p>
          {config.archived
            ? "旧版保本与移动止盈按原始 R 阈值执行。"
            : config.channel
              ? "ATR 硬止损在入场时冻结；此前反向通道在完整交易 K 线收盘后确认退出，下分钟开盘成交。不启用保本或 ATR 移动止盈。"
              : config.staged
                ? "初始止损使用信号 ATR，初始 R 距离固定。完整交易 K 线收盘达到阈值后锁定保本与跟踪状态；跟踪使用当前 ATR 14 和入场以来极值。保护线只收紧，若越过收盘则锁定下一分钟开盘退出。"
                : "止损、保本触发和移动距离使用信号收盘时冻结的 ATR；移动止盈无需单独启动阈值。"}
          初始止损在入场后立即生效；收盘决策在下一分钟生效。跳空按更不利的开盘价成交。当前按分钟
          OHLC 回放，未模拟逐笔撮合、市场冲击、强平或 ADL。
        </p>
        <p>
          手续费 {config.execution.feeBps} bps，滑点 {config.execution.slippageBps} bps，价格步长{" "}
          {config.execution.tickSize}，数量步长 {config.execution.quantityStep}
          ；这些为参数假设。资金费净支出为负表示收到资金费。
        </p>
        <p>
          实际预热{" "}
          {((result.window ?? manifest).startTime - (result.window ?? manifest).warmupStart) / DAY}{" "}
          天 · 缓存覆盖 {manifest.rows.toLocaleString()} 分钟 · {manifest.partitions.length}{" "}
          行情分片
        </p>
        {manifest.partitions.map((p) => (
          <p key={p.from}>
            <a href={p.source} target="_blank" rel="noreferrer">
              {utcDate(p.from)} 成交价档案
            </a>
            <code>{p.checksum}</code>
          </p>
        ))}
      </details>
    </div>
  );
}
