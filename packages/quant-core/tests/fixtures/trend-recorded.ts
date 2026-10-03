import type {
  RecordedTrendConfigV2,
  RecordedTrendConfigV3,
  RecordedTrendConfigV4,
  RecordedTrendConfigV5,
  RecordedTrendConfigV6,
  RecordedTrendConfigV7,
  RecordedTrendConfigV8,
  RecordedTrendConfigV9,
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
export const RECORDED_V5: RecordedTrendConfigV5 = {
  version: 5,
  strategy: { ...RECORDED_V4.strategy, maxCostAtr: 0.75 },
  execution: { ...RECORDED_V4.execution },
  risk: { ...RECORDED_V4.risk },
};
export const RECORDED_V6: RecordedTrendConfigV6 = {
  version: 6,
  strategy: {
    entry: "kdj",
    filter: "slow-ema",
    maxCostAtr: 0.5,
    management: "staged",
    staged: { breakEvenR: 1, trailingStartR: 2 },
    direction: "both",
    tradeMinutes: 5,
    breakoutBars: 20,
    stopAtr: 2,
    breakEvenAtr: 0,
    trailingAtr: 3,
  },
  execution: { ...RECORDED_V2.execution },
  risk: { ...RECORDED_V2.risk },
};
export const RECORDED_V7: RecordedTrendConfigV7 = {
  version: 7,
  strategy: {
    entry: "price-action",
    filter: "slow-ema",
    maxCostAtr: 0.5,
    management: "staged",
    staged: { breakEvenR: 1, trailingStartR: 2 },
    priceAction: { keyLevel: true, twoLegs: false },
    direction: "both",
    tradeMinutes: 5,
    breakoutBars: 20,
    stopAtr: 2,
    breakEvenAtr: 0,
    trailingAtr: 3,
  },
  execution: { ...RECORDED_V2.execution },
  risk: { ...RECORDED_V2.risk },
};

export const RECORDED_V8: RecordedTrendConfigV8 = {
  version: 8,
  strategy: {
    entry: "breakout",
    filter: "none",
    maxCostAtr: 0,
    management: "channel",
    direction: "long",
    tradeMinutes: 30,
    breakoutBars: 320,
    channelExitBars: 160,
    breakoutReentry: "episode",
    stopAtr: 2,
    breakEvenAtr: 0,
    trailingAtr: 3,
  },
  execution: { ...RECORDED_V2.execution },
  risk: { ...RECORDED_V2.risk, dailyLossPct: 0 },
};

export const RECORDED_V9: RecordedTrendConfigV9 = {
  version: 9,
  strategy: {
    entry: "structured-pullback",
    filter: "ema",
    maxCostAtr: 0,
    management: "chandelier",
    direction: "both",
    tradeMinutes: 30,
    breakoutBars: 20,
    stopAtr: 2,
    breakEvenAtr: 0,
    trailingAtr: 3,
    structuredPullback: { keyLevel: "either", shape: "any", candle: "none" },
  },
  execution: { ...RECORDED_V2.execution },
  risk: { ...RECORDED_V2.risk, dailyLossPct: 0 },
};
