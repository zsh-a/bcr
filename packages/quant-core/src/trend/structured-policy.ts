/** Current structured-pullback choices. Historical schemas and migrations stay frozen separately. */
export const STRUCTURED_PULLBACK_OPTIONS = {
  keyLevel: [
    { value: "either", label: "已确认摆动点或已验证 EMA" },
    { value: "pivot", label: "已确认摆动点" },
    { value: "validated-ema", label: "已验证 EMA 支撑 / 阻力" },
    { value: "none", label: "不设关键位门槛" },
  ],
  shape: [
    { value: "any", label: "至少一种已确认结构" },
    { value: "two-legs", label: "两段回调" },
    { value: "wedge", label: "三推楔形" },
    { value: "channel", label: "平行通道" },
    { value: "double-test", label: "双底 / 双顶" },
    { value: "none", label: "不设结构门槛" },
  ],
  candle: [
    { value: "none", label: "记录形态，不设额外门槛" },
    { value: "reversal", label: "要求反转确认" },
  ],
  confirmation: [
    { value: "before-breakout", label: "突破 K 线之前已确认" },
    { value: "signal-close", label: "允许突破 K 线收盘确认" },
  ],
  keyRole: [
    { value: "pullback-retest", label: "要求本次回调重新测试" },
    { value: "impulse-context", label: "作为推进背景，不要求回踩" },
  ],
} as const;

export type StructuredPullbackPolicy = {
  -readonly [
    Field in keyof typeof STRUCTURED_PULLBACK_OPTIONS
  ]: (typeof STRUCTURED_PULLBACK_OPTIONS)[Field][number]["value"];
};

export const DEFAULT_STRUCTURED_PULLBACK_POLICY: Readonly<StructuredPullbackPolicy> = Object.freeze(
  {
    keyLevel: "either",
    shape: "any",
    candle: "none",
    confirmation: "before-breakout",
    keyRole: "pullback-retest",
  },
);
