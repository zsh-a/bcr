/** Current structured-pullback choices. Historical schemas and migrations stay frozen separately. */
export const STRUCTURED_PULLBACK_VALUES = {
  keyLevel: ["either", "pivot", "validated-ema", "none"],
  shape: ["any", "two-legs", "wedge", "channel", "double-test", "none"],
  candle: ["none", "reversal"],
  confirmation: ["before-breakout", "signal-close"],
  keyRole: ["pullback-retest", "impulse-context"],
} as const;

export type StructuredPullbackPolicy = {
  -readonly [
    Field in keyof typeof STRUCTURED_PULLBACK_VALUES
  ]: (typeof STRUCTURED_PULLBACK_VALUES)[Field][number];
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
