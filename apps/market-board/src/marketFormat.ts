import type { DataQuality, SessionState } from "@bcr/market-data";

export function signed(value: number): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

export function price(value: number): string {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: value >= 10_000 ? 0 : value >= 100 ? 2 : 3,
  }).format(value);
}

export function compact(value: number | null): string {
  if (value === null) return "—";
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(
    value,
  );
}

export function receivedTime(value: number): string {
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(value);
}

export function sessionLabel(state: SessionState): string {
  return {
    pre_market: "盘前",
    open: "交易中",
    lunch_break: "午间休市",
    after_hours: "盘后",
    closed: "休市",
    planned: "待开盘",
  }[state];
}

export function qualityLabel(quality: DataQuality): string {
  return {
    delayed: "延迟行情",
    partial: "部分行情",
    cached: "缓存行情",
    demo: "示例行情",
  }[quality];
}
