import { STRUCTURED_PULLBACK_LABELS } from "../workbench/structured-pullback-labels";

const parameters: Record<string, string> = {
  "strategy.entry": "入场机制",
  "strategy.filter": "趋势过滤",
  "strategy.direction": "交易方向",
  "strategy.tradeMinutes": "交易周期 · 分钟",
  "strategy.breakoutBars": "突破窗口 · 根",
  "strategy.channelExitBars": "退出通道 · 根",
  "strategy.breakoutReentry": "再次入场",
  "strategy.management": "持仓管理",
  "strategy.stopAtr": "初始止损 · ATR",
  "strategy.breakEvenAtr": "保本触发 · ATR",
  "strategy.trailingAtr": "跟踪距离 · ATR",
  "strategy.maxCostAtr": "成本门槛 · ATR",
  "strategy.staged.breakEvenR": "保本触发 · R",
  "strategy.staged.trailingStartR": "跟踪启动 · R",
  "strategy.structuredPullback.keyLevel": "关键位要求",
  "strategy.structuredPullback.shape": "回调结构",
  "strategy.structuredPullback.candle": "K 线确认",
  "strategy.structuredPullback.confirmation": "结构确认时点",
  "strategy.structuredPullback.keyRole": "关键位用途",
  "risk.riskPct": "每笔风险比例",
  "risk.maxExposurePct": "敞口上限比例",
  "risk.dailyLossPct": "日亏损上限比例",
  "risk.cooldownLosses": "冷却连亏笔数",
  "risk.cooldownMinutes": "冷却 · 分钟",
  "risk.flattenMinute": "每日退出 · UTC 分钟",
};

export const parameterLabel = (key: string) => parameters[key] ?? key;
export function parameterValue(
  key: string,
  value: string | number | boolean | null | undefined,
): string {
  const field = key.replace("strategy.structuredPullback.", "");
  const labels = (STRUCTURED_PULLBACK_LABELS as Record<string, Record<string, string>>)[field];
  return labels?.[String(value)] ?? (value === null || value === undefined ? "—" : String(value));
}
