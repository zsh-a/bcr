export const money = (value: number) =>
  new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 }).format(value);
export const percent = (value: number) => `${(value * 100).toFixed(2)}%`;
const reasons: Record<string, string> = {
  rebalance: "调仓",
  "stop-loss": "个股止损",
  "trailing-stop": "移动止盈",
  "max-drawdown": "组合回撤",
  "daily-loss": "单日亏损",
  "take-profit": "固定止盈",
  "position-cap": "单股仓位上限",
  "exposure-cap": "总仓位上限",
  "limit-open": "涨停打开",
  "limit-up-open": "涨停打开",
  "limit-up-opened": "涨停打开",
};
export const orderReason = (value: string) => reasons[value] ?? value;
const statuses: Record<string, string> = {
  filled: "已成交",
  partial: "部分成交",
  rejected: "已拒单",
  "missing-bar": "缺少行情",
  suspended: "停牌",
  "limit-up": "涨停限制",
  "limit-down": "跌停限制",
  "not-sellable": "数量不可卖",
  "volume-limit": "成交量限制",
  "insufficient-cash": "现金不足",
  "position-cap": "单股仓位限制",
  "exposure-cap": "总仓位限制",
  "no-cash": "现金不足",
};
export const orderStatus = (value: string) => statuses[value] ?? value;
export const orderTiming = (value: string) =>
  value === "next-open" ? "次日开盘" : value === "close" ? "当日收盘" : value;

export const timeLabel = (value: string) =>
  new Date(value).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
export const compactMoney = (value: number) =>
  value >= 10000 ? `${money(value / 10000)} 万元` : `${money(value)} 元`;
