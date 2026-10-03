import type { StructuredPullbackPolicy } from "@bcr/quant-core/trend";

/** Presentation text is complete for the core's allowed values, without defining new rules. */
export const STRUCTURED_PULLBACK_LABELS = {
  keyLevel: {
    either: "已确认摆动点或已验证 EMA",
    pivot: "已确认摆动点",
    "validated-ema": "已验证 EMA 支撑 / 阻力",
    none: "不设关键位门槛",
  },
  shape: {
    any: "至少一种已确认结构",
    "two-legs": "两段回调",
    wedge: "三推楔形",
    channel: "平行通道",
    "double-test": "双底 / 双顶",
    none: "不设结构门槛",
  },
  candle: {
    none: "记录形态，不设额外门槛",
    reversal: "要求反转确认",
  },
  confirmation: {
    "before-breakout": "突破 K 线之前已确认",
    "signal-close": "允许突破 K 线收盘确认",
  },
  keyRole: {
    "pullback-retest": "要求本次回调重新测试",
    "impulse-context": "作为推进背景，不要求回踩",
  },
} satisfies {
  [Field in keyof StructuredPullbackPolicy]: Record<StructuredPullbackPolicy[Field], string>;
};
