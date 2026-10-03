import { utcDate, validateBinanceRequest } from "@bcr/market-data/binance/model";
import {
  TREND_PERIODS,
  strategyLabel,
  trendRunView,
  periodLabel,
  withTradingPeriod,
  validateTrendConfig,
  filterLabel,
  directionLabel,
  costFilterLabel,
  managementLabel,
} from "@bcr/quant-core/trend";
import {
  Button,
  Dialog,
  Input,
  PanelEmpty,
  ProgressBar,
  Select,
  Spinner,
  WorkspaceTrigger,
} from "@bcr/react";
import { History, Play, SlidersHorizontal, Square, X } from "lucide-react";
import { useEffect, useState } from "react";
import { StrategyPicker } from "../../workbench/StrategyPicker";
import { TrendResult } from "../results/TrendResult";
import { canReuseTrendDataset } from "../execution/window";
import { useTrendResearch } from "../session/useTrendResearch";
import { TrendSettings } from "./TrendSettings";
import { TrendResearchPanel } from "../research/TrendResearchPanel";
import "./styles.css";

export function TrendWorkbench({ onBusy }: { onBusy: (busy: boolean) => void }) {
  const research = useTrendResearch();
  const [review, setReview] = useState(false);
  const [settings, setSettings] = useState(false),
    [history, setHistory] = useState(false);
  useEffect(() => {
    onBusy(research.busy);
    return () => onBusy(false);
  }, [research.busy, onBusy]);
  let invalid = "";
  try {
    validateBinanceRequest(research.request);
    validateTrendConfig(research.config);
  } catch (e) {
    invalid = String(e);
  }
  const datasetMatches = canReuseTrendDataset(research.dataset, research.request, research.config);
  const changed =
    research.selected &&
    (JSON.stringify(research.selected.config) !== JSON.stringify(research.config) ||
      research.selected.dataset.manifest.symbol !== research.request.symbol ||
      utcDate(research.selected.dataset.manifest.startTime) !== research.request.start ||
      utcDate(research.selected.dataset.manifest.endTime - 1) !== research.request.end);
  return (
    <div className="trend-workspace">
      <header className="research-header">
        <WorkspaceTrigger />
        <div className="research-brand">
          <h1>Quant Lab</h1>
        </div>
        <div className="research-actions">
          <StrategyPicker value="trend" disabled={research.busy} />
          <Button
            variant="ghost"
            aria-label="研究证据面板"
            aria-pressed={review}
            disabled={research.busy}
            onClick={() => setReview(!review)}
          >
            {review ? "返回回测" : "研究证据"}
          </Button>
          {!review && (
            <>
              <Button
                variant="ghost"
                aria-label="趋势运行历史"
                disabled={!research.runs.length || research.busy}
                onClick={() => setHistory(true)}
              >
                <History size={16} />
                <span>历史</span>
              </Button>
              <Button
                variant="ghost"
                aria-label="趋势参数设置"
                disabled={research.busy}
                onClick={() => setSettings(true)}
              >
                <SlidersHorizontal size={16} />
                <span>参数</span>
              </Button>
              {research.busy ? (
                <Button onClick={research.cancel}>
                  <Square size={14} />
                  取消
                </Button>
              ) : (
                <Button
                  variant="primary"
                  className="research-run-button"
                  disabled={!research.ready || !!invalid}
                  title={invalid || undefined}
                  onClick={() => void research.run()}
                >
                  <Play size={15} />
                  <span>{datasetMatches ? "运行回测" : "获取并回测"}</span>
                </Button>
              )}
            </>
          )}
        </div>
      </header>
      {!review && (
        <div className="trend-source">
          <span className="trend-provider">Binance · USDT 永续</span>
          <label>
            交易对
            <Input
              aria-label="Binance 交易对"
              value={research.request.symbol}
              disabled={research.busy}
              onChange={(e) =>
                research.setRequest({
                  ...research.request,
                  symbol: e.target.value.toUpperCase().trim(),
                })
              }
            />
          </label>
          <label>
            开始
            <Input
              aria-label="Binance 开始日期"
              type="date"
              value={research.request.start}
              disabled={research.busy}
              onChange={(e) => research.setRequest({ ...research.request, start: e.target.value })}
            />
          </label>
          <label>
            结束
            <Input
              aria-label="Binance 结束日期"
              type="date"
              value={research.request.end}
              disabled={research.busy}
              onChange={(e) => research.setRequest({ ...research.request, end: e.target.value })}
            />
          </label>
          <label>
            交易周期
            <Select
              aria-label="回测交易周期"
              value={research.config.strategy.tradeMinutes}
              disabled={research.busy}
              onChange={(e) =>
                research.setConfig(withTradingPeriod(research.config, Number(e.target.value)))
              }
            >
              {TREND_PERIODS.map((m) => (
                <option key={m} value={m}>
                  {periodLabel(m)}
                </option>
              ))}
            </Select>
          </label>
          <span className="trend-source-note">UTC · 1 分钟执行</span>
          {datasetMatches && (
            <Button
              variant="ghost"
              size="sm"
              disabled={research.busy || !!invalid}
              onClick={() => void research.run(true)}
            >
              更新档案
            </Button>
          )}
        </div>
      )}
      {research.busy && (
        <div className="trend-progress" role="status">
          <Spinner size="sm" />
          <span>{research.status}</span>
          <ProgressBar value={research.progress} label="趋势任务进度" />
        </div>
      )}
      {research.error && (
        <div className="trend-error" role="alert">
          <span>{research.error}</span>
          {research.ready && (
            <Button variant="ghost" size="sm" aria-label="关闭错误" onClick={research.dismissError}>
              <X size={14} />
            </Button>
          )}
        </div>
      )}
      {research.notice && (
        <div className="trend-notice" role="status">
          <span>{research.notice}</span>
          <Button
            variant="ghost"
            size="sm"
            aria-label="关闭参数迁移提示"
            onClick={research.dismissNotice}
          >
            <X size={14} />
          </Button>
        </div>
      )}
      {invalid && (
        <p className="trend-error" role="alert">
          {invalid}
        </p>
      )}
      <main className="trend-content">
        <div hidden={!review}>
          <TrendResearchPanel />
        </div>
        {review ? null : research.selected && research.result ? (
          <TrendResult
            key={research.selected.id}
            run={research.selected}
            result={research.result}
          />
        ) : research.resultState.status === "error" ? (
          <div className="trend-error" role="alert">
            <span>{research.resultState.error}</span>
            <Button variant="ghost" size="sm" onClick={research.retryResult}>
              重试读取结果
            </Button>
          </div>
        ) : research.selected ? (
          <PanelEmpty title="正在读取回测结果" />
        ) : (
          <div className="trend-intro">
            <span className="trend-eyebrow">趋势延续研究</span>
            <h2>
              {research.config.strategy.entry === "structured-pullback"
                ? "先确认趋势，再等结构化回调。"
                : research.config.strategy.entry === "price-action"
                  ? "先有强推进，再等回调突破。"
                  : research.config.strategy.entry === "kdj"
                    ? "等回调，再看 KDJ 交叉。"
                    : research.config.strategy.filter === "background"
                      ? "先看背景，再捕捉突破。"
                      : "捕捉突破，让趋势延续。"}
            </h2>
            <p>
              {research.config.strategy.entry === "structured-pullback"
                ? "记录推进能量、已确认关键位与回调结构；收盘越过整段推进极值后，下一分钟尝试入场。"
                : research.config.strategy.entry === "price-action"
                  ? "冻结推进前波动与完整推进极值，记录关键位和回调腿结构；首次收盘突破后下一分钟尝试入场。"
                  : research.config.strategy.entry === "kdj"
                    ? "K 进入低位或高位区域后，等待后续完整 K 线确认交叉，下一分钟尝试入场。"
                    : research.config.strategy.filter === "background"
                      ? "较大周期判断方向与结构，交易周期确认突破，下一分钟尝试入场。"
                      : "已收盘的交易周期 K 线确认突破，下一分钟尝试入场。"}{" "}
              {research.config.strategy.management === "channel"
                ? "用 ATR 限制试错成本，反向通道退出，让盈利趋势有继续延伸的空间。"
                : research.config.strategy.management === "chandelier"
                  ? "从第一根完整交易 K 线开始动态 ATR 跟踪，无主动保本或盈利启动阈值。"
                  : research.config.strategy.management === "staged"
                    ? "收盘初始 R 达标后锁定保本与动态 ATR 跟踪，保护线越过收盘则锁定次开盘退出。"
                    : "用 ATR 限制试错成本，保本和移动止损跟随趋势。"}
            </p>
            <ol>
              <li>
                <strong>入场环境</strong>
                <span>
                  {filterLabel(research.config.strategy)} ·{" "}
                  {costFilterLabel(research.config.strategy.maxCostAtr)}
                </span>
              </li>
              <li>
                <strong>确认入场</strong>
                <span>
                  {strategyLabel(research.config.strategy.entry, research.config.strategy.filter)} ·{" "}
                  {periodLabel(research.config.strategy.tradeMinutes)}
                  {" · "}
                  {directionLabel(research.config.strategy.direction)}
                </span>
              </li>
              <li>
                <strong>保护持仓</strong>
                <span>
                  初始 {research.config.strategy.stopAtr} ATR ·{" "}
                  {research.config.strategy.management === "channel" ? (
                    managementLabel(research.config.strategy)
                  ) : research.config.strategy.management === "chandelier" ? (
                    "从第一根完整交易 K 线开始动态 ATR 跟踪，无主动保本或盈利启动阈值。"
                  ) : research.config.strategy.management === "staged" ? (
                    `保本 ${research.config.strategy.staged?.breakEvenR} R · 跟踪启动 ${research.config.strategy.staged?.trailingStartR} R · 动态 ${research.config.strategy.trailingAtr} ATR`
                  ) : (
                    <>
                      保本 {research.config.strategy.breakEvenAtr} ATR · 移动{" "}
                      {research.config.strategy.trailingAtr} ATR
                    </>
                  )}
                </span>
              </li>
              <li>
                <strong>控制风险</strong>
                <span>
                  每笔 {research.config.risk.riskPct * 100}% ·{" "}
                  {research.config.risk.flattenMinute === null ? "允许跨日持仓" : "每日定时平仓"}
                </span>
              </li>
            </ol>
            <p className="trend-help">
              直接获取官方历史档案，无需 API Key。选择已发布的历史月份，数据校验与回放在 Worker
              中完成；再次调整参数可复用本地行情。
            </p>
            <p className="trend-help">
              {research.config.strategy.entry === "kdj"
                ? "KDJ 回调研究来自截图推测，不是博主规则的精确复现；研究假设尚未通过统计与样本外验证。"
                : "背景过滤可减少缺少趋势支持的入场，也可能错过趋势启动；研究候选尚未通过全部统计门槛。"}
            </p>
            <Button variant="ghost" onClick={() => setSettings(true)}>
              查看规则与参数
            </Button>
          </div>
        )}
      </main>
      <footer className="trend-footer">
        <span>
          {review
            ? "本地导入 · 冻结研究证据"
            : research.busy
              ? research.status
              : changed
                ? "参数或区间已修改 · 下次运行生效"
                : research.status || "本地研究 · 历史回放"}
        </span>
        <span>
          {review ? "账户统计 · 以文件声明的窗口与成本为准" : "资金费：历史费率 × 分钟开盘标记价格"}
        </span>
      </footer>
      <TrendSettings
        open={settings}
        onClose={() => setSettings(false)}
        config={research.config}
        onChange={research.setConfig}
      />
      <Dialog
        open={history}
        onClose={() => setHistory(false)}
        title="趋势运行历史"
        className="trend-history"
      >
        {research.runs.map((run) => {
          const view = trendRunView(run);
          return (
            <Button
              key={run.id}
              variant="ghost"
              aria-pressed={run.id === research.selected?.id}
              onClick={() => {
                research.select(run.id);
                setHistory(false);
              }}
            >
              <span>
                <strong>
                  {run.dataset.manifest.symbol} · {periodLabel(view.tradeMinutes)} ·{" "}
                  {view.direction} · {view.label}
                </strong>
                <small>
                  {utcDate(run.dataset.manifest.startTime)} —{" "}
                  {utcDate(run.dataset.manifest.endTime - 1)} ·{" "}
                  {new Date(run.createdAt).toLocaleString()} · {view.filter} · {view.management}
                </small>
              </span>
              <span>{(run.metrics.totalReturn * 100).toFixed(2)}%</span>
            </Button>
          );
        })}
      </Dialog>
    </div>
  );
}
