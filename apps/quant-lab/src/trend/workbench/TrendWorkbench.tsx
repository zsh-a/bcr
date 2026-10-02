import { DAY, utcDate, validateBinanceRequest } from "@bcr/market-data/binance/model";
import {
  TREND_PERIODS,
  periodLabel,
  trendWarmupDays,
  withTradingPeriod,
  validateTrendConfig,
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
import { useTrendResearch } from "../session/useTrendResearch";
import { TrendSettings } from "./TrendSettings";
import "./styles.css";

export function TrendWorkbench({ onBusy }: { onBusy: (busy: boolean) => void }) {
  const research = useTrendResearch();
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
  const datasetMatches =
    research.dataset?.manifest.symbol === research.request.symbol &&
    utcDate(research.dataset.manifest.startTime) === research.request.start &&
    utcDate(research.dataset.manifest.endTime - 1) === research.request.end &&
    research.dataset.manifest.startTime - research.dataset.manifest.warmupStart >=
      trendWarmupDays(research.config) * DAY;
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
        </div>
      </header>
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
            value={research.config.tradeMinutes}
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
          <Button variant="ghost" size="sm" aria-label="关闭错误" onClick={research.dismissError}>
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
        {research.selected && research.result ? (
          <TrendResult
            key={research.selected.id}
            run={research.selected}
            result={research.result}
          />
        ) : research.selected ? (
          <PanelEmpty title="正在读取回测结果" />
        ) : (
          <div className="trend-intro">
            <span className="trend-eyebrow">趋势延续研究</span>
            <h2>强推进之后，等待回调再入场。</h2>
            <p>
              已收盘的趋势周期 EMA 确认方向；交易周期内的推进、回调与再突破触发交易。用 ATR
              限制试错成本，用保本和移动止损跟随趋势。
            </p>
            <ol>
              <li>
                <strong>确认趋势</strong>
                <span>
                  {periodLabel(research.config.trendMinutes)} EMA {research.config.fastEma} /{" "}
                  {research.config.slowEma}
                </span>
              </li>
              <li>
                <strong>等待入场</strong>
                <span>
                  {research.config.entry === "pullback"
                    ? "强推进 → 浅回调 → 再突破"
                    : `${research.config.breakoutBars} 根 K 线通道突破`}
                  {" · "}
                  {periodLabel(research.config.tradeMinutes)}
                </span>
              </li>
              <li>
                <strong>控制风险</strong>
                <span>每笔 {research.config.riskPct * 100}% · 连亏暂停 · 可选每日平仓</span>
              </li>
            </ol>
            <p className="trend-help">
              直接获取官方历史档案，无需 API Key。选择已发布的历史月份，数据校验与回放在 Worker
              中完成；再次调整参数可复用本地行情。
            </p>
            <Button variant="ghost" onClick={() => setSettings(true)}>
              查看规则与参数
            </Button>
          </div>
        )}
      </main>
      <footer className="trend-footer">
        <span>
          {research.busy
            ? research.status
            : changed
              ? "参数或区间已修改 · 下次运行生效"
              : research.status || "本地研究 · 历史回放"}
        </span>
        <span>资金费：历史费率 × 分钟开盘标记价格</span>
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
        {research.runs.map((run) => (
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
                {run.dataset.manifest.symbol} · {periodLabel(run.config.tradeMinutes)} ·{" "}
                {run.config.entry === "pullback" ? "回调突破" : "通道突破"}
              </strong>
              <small>
                {utcDate(run.dataset.manifest.startTime)} —{" "}
                {utcDate(run.dataset.manifest.endTime - 1)} ·{" "}
                {new Date(run.createdAt).toLocaleString()}
              </small>
            </span>
            <span>{(run.metrics.totalReturn * 100).toFixed(2)}%</span>
          </Button>
        ))}
      </Dialog>
    </div>
  );
}
