import {
  DEFAULT_TREND_CONFIG,
  TREND_PERIODS,
  periodLabel,
  trendWarmupDays,
  withTradingPeriod,
  validateTrendConfig,
  type TrendConfig,
} from "@bcr/quant-core/trend";
import { Button, Dialog, Input, Select } from "@bcr/react";

const groups: { title: string; fields: [keyof TrendConfig, string, number, number?][] }[] = [
  {
    title: "资金与成交",
    fields: [
      ["initialCapital", "初始资金 · USDT", 100],
      ["riskPct", "每笔风险 · %", 0.1, 100],
      ["maxExposurePct", "最大名义敞口 · %", 1, 100],
      ["feeBps", "单边手续费 · bps", 0.1],
      ["slippageBps", "单边滑点 · bps", 0.1],
    ],
  },
  {
    title: "趋势与入场",
    fields: [
      ["fastEma", "趋势快 EMA", 1],
      ["slowEma", "趋势慢 EMA", 1],
      ["atrPeriod", "ATR 窗口 · 根 K 线", 1],
      ["impulseBars", "推进窗口 · 根 K 线", 1],
      ["impulseAtr", "最小推进 · ATR", 0.1],
      ["minEfficiency", "推进方向效率 · %", 5, 100],
      ["minPullbackBars", "最短回调 · 根 K 线", 1],
      ["maxPullbackBars", "最长回调 · 根 K 线", 1],
      ["minRetracement", "最小回调深度 · %", 5, 100],
      ["maxRetracement", "最大回调深度 · %", 5, 100],
      ["breakoutBars", "通道突破窗口 · 根 K 线", 1],
    ],
  },
  {
    title: "止损与退出",
    fields: [
      ["stopAtr", "初始止损下限 · ATR", 0.1],
      ["maxStopAtr", "最大止损距离 · ATR", 0.1],
      ["breakEvenR", "保本触发 · R（0 关闭）", 0.1],
      ["trailingStartR", "移动止盈触发 · R", 0.1],
      ["trailingAtr", "移动止盈距离 · ATR", 0.1],
      ["cooldownLosses", "连续亏损次数（0 关闭）", 1],
      ["cooldownMinutes", "暂停开仓 · 分钟", 1],
      ["dailyLossPct", "单日亏损限制 · %（0 关闭）", 0.1, 100],
    ],
  },
  {
    title: "合约精度假设",
    fields: [
      ["tickSize", "最小价格步长", 0.01],
      ["quantityStep", "最小数量步长", 0.001],
      ["minNotional", "最小订单名义价值 · USDT", 1],
    ],
  },
];
export function TrendSettings({
  open,
  onClose,
  config,
  onChange,
}: {
  open: boolean;
  onClose: () => void;
  config: TrendConfig;
  onChange: (config: TrendConfig) => void;
}) {
  let error = "";
  try {
    validateTrendConfig(config);
  } catch (e) {
    error = String(e);
  }
  return (
    <Dialog open={open} onClose={onClose} title="趋势策略参数" className="trend-settings">
      <p className="trend-help">
        信号在{periodLabel(config.tradeMinutes)} K
        线收盘确认，下一分钟开盘成交。ATR、推进和回调窗口按交易周期计算。R
        为初始价格止损风险；净收益包含双边费用、滑点与资金费。
      </p>
      <div className="trend-fields">
        <label>
          入场规则
          <Select
            aria-label="入场规则"
            value={config.entry}
            onChange={(e) => onChange({ ...config, entry: e.target.value as TrendConfig["entry"] })}
          >
            <option value="pullback">强趋势回调突破</option>
            <option value="breakout">通道突破基线</option>
          </Select>
        </label>
        <label>
          交易方向
          <Select
            aria-label="交易方向"
            value={config.direction}
            onChange={(e) =>
              onChange({ ...config, direction: e.target.value as TrendConfig["direction"] })
            }
          >
            <option value="both">双向</option>
            <option value="long">仅做多</option>
            <option value="short">仅做空</option>
          </Select>
        </label>
        <label>
          交易周期
          <Select
            aria-label="交易周期"
            value={config.tradeMinutes}
            onChange={(e) => onChange(withTradingPeriod(config, Number(e.target.value)))}
          >
            {TREND_PERIODS.map((m) => (
              <option key={m} value={m}>
                {periodLabel(m)}
              </option>
            ))}
          </Select>
        </label>
        <label>
          趋势确认周期
          <Select
            aria-label="趋势确认周期"
            value={config.trendMinutes}
            onChange={(e) => onChange({ ...config, trendMinutes: Number(e.target.value) })}
          >
            {TREND_PERIODS.filter((m) => m >= config.tradeMinutes).map((m) => (
              <option key={m} value={m}>
                {periodLabel(m)}
              </option>
            ))}
          </Select>
        </label>
        <label>
          UTC 每日平仓
          <Input
            type="time"
            disabled={config.tradeMinutes === 1440}
            value={
              config.flattenMinute === null
                ? ""
                : `${String(Math.floor(config.flattenMinute / 60)).padStart(2, "0")}:${String(config.flattenMinute % 60).padStart(2, "0")}`
            }
            onChange={(e) => {
              const [h, m] = e.target.value.split(":").map(Number);
              onChange({ ...config, flattenMinute: e.target.value ? h! * 60 + m! : null });
            }}
          />
        </label>
      </div>
      <Button
        variant="ghost"
        size="sm"
        disabled={config.tradeMinutes === 1440}
        onClick={() =>
          onChange({ ...config, flattenMinute: config.flattenMinute === null ? 1437 : null })
        }
      >
        {config.flattenMinute === null ? "启用每日平仓" : "关闭每日平仓，允许全天持仓"}
      </Button>
      <p className="trend-help">
        自动获取 {trendWarmupDays(config)} 天预热行情；趋势确认周期不小于交易周期。
        {config.tradeMinutes === 1440 && "日线已关闭每日平仓，允许跨日持仓。"}
      </p>
      {groups.map((group) => (
        <details key={group.title} open={group.title === "资金与成交" || undefined}>
          <summary>{group.title}</summary>
          <div className="trend-fields">
            {group.fields.map(([key, label, step, scale = 1]) => (
              <label key={key}>
                {label}
                <Input
                  type="number"
                  step={step}
                  value={Number(config[key]) * scale}
                  onChange={(e) => onChange({ ...config, [key]: e.target.valueAsNumber / scale })}
                />
              </label>
            ))}
          </div>
        </details>
      ))}
      <p className="trend-help">
        费用与合约步长需要按研究标的设置，未假定历史交易所精度恒定。敞口上限为资金的
        100%，当前引擎不模拟交易所强平和 ADL。
      </p>
      {error && (
        <p role="alert" className="trend-error">
          {error}
        </p>
      )}
      <div className="trend-dialog-actions">
        <Button onClick={() => onChange({ ...DEFAULT_TREND_CONFIG })}>恢复默认</Button>
        <Button variant="primary" disabled={!!error} onClick={onClose}>
          完成
        </Button>
      </div>
    </Dialog>
  );
}
