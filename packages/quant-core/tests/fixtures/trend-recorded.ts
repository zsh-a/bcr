import type {
  RecordedTrendConfigV2,
  RecordedTrendConfigV3,
  RecordedTrendConfigV4,
} from "../../src/trend";

// Literal historical fixtures intentionally do not import current defaults.
export const RECORDED_V2: RecordedTrendConfigV2 = {
  version: 2,
  strategy: {
    entry: "breakout",
    filter: "none",
    direction: "both",
    tradeMinutes: 1,
    breakoutBars: 20,
    stopAtr: 1.5,
    breakEvenAtr: 1.5,
    trailingAtr: 2,
  },
  execution: {
    initialCapital: 10000,
    feeBps: 5,
    slippageBps: 2,
    tickSize: 0.1,
    quantityStep: 0.001,
    minNotional: 100,
  },
  risk: {
    riskPct: 0.005,
    maxExposurePct: 0.95,
    cooldownLosses: 3,
    cooldownMinutes: 60,
    dailyLossPct: 0.03,
    flattenMinute: null,
  },
};
export const RECORDED_V3: RecordedTrendConfigV3 = {
  version: 3,
  strategy: { ...RECORDED_V2.strategy, filter: "background" },
  execution: { ...RECORDED_V2.execution },
  risk: { ...RECORDED_V2.risk },
};
export const RECORDED_V4: RecordedTrendConfigV4 = {
  version: 4,
  strategy: { ...RECORDED_V3.strategy, management: "atr" },
  execution: { ...RECORDED_V3.execution },
  risk: { ...RECORDED_V3.risk },
};
