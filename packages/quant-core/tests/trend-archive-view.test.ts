import { describe, expect, it } from "vitest";
import {
  createTrendConfig,
  trendRunView,
  validateRecordedTrendConfig,
  type TrendRun,
} from "../src/trend";
import {
  RECORDED_V2,
  RECORDED_V3,
  RECORDED_V4,
  RECORDED_V5,
  RECORDED_V6,
  RECORDED_V7,
  RECORDED_V8,
  RECORDED_V9,
} from "./fixtures/trend-recorded";

const cases = [
  {
    config: RECORDED_V2,
    ruleVersion: 3,
    label: "通道突破基线",
    management: "保本与 ATR 移动止盈",
    costFilter: "成本门槛关闭",
    staged: false,
    slowEma: false,
    backgroundMinutes: null,
    channelConfig: { tradeMinutes: 1, entryBars: 20, exitBars: null },
  },
  {
    config: RECORDED_V3,
    ruleVersion: 4,
    label: "通道突破",
    management: "保本与 ATR 移动止盈",
    costFilter: "往返成本 ≤ 0.5 ATR",
    staged: false,
    slowEma: false,
    backgroundMinutes: 5,
    channelConfig: { tradeMinutes: 1, entryBars: 20, exitBars: null },
  },
  {
    config: RECORDED_V4,
    ruleVersion: 5,
    label: "通道突破",
    management: "保本与 ATR 移动止盈",
    costFilter: "往返成本 ≤ 0.5 ATR",
    staged: false,
    slowEma: false,
    backgroundMinutes: 5,
    channelConfig: { tradeMinutes: 1, entryBars: 20, exitBars: null },
  },
  {
    config: RECORDED_V5,
    ruleVersion: 6,
    label: "通道突破",
    management: "保本与 ATR 移动止盈",
    costFilter: "往返成本 ≤ 0.75 ATR",
    staged: false,
    slowEma: false,
    backgroundMinutes: 5,
    channelConfig: { tradeMinutes: 1, entryBars: 20, exitBars: null },
  },
  {
    config: RECORDED_V6,
    ruleVersion: 7,
    label: "KDJ 回调研究",
    management: "收盘 R 分段保护 · 动态 ATR 跟踪",
    costFilter: "往返成本 ≤ 0.5 ATR",
    staged: true,
    slowEma: true,
    backgroundMinutes: null,
    channelConfig: undefined,
  },
  {
    config: RECORDED_V7,
    ruleVersion: 8,
    label: "价格行为回调研究",
    management: "收盘 R 分段保护 · 动态 ATR 跟踪",
    costFilter: "往返成本 ≤ 0.5 ATR",
    staged: true,
    slowEma: true,
    backgroundMinutes: null,
    channelConfig: undefined,
  },
  {
    config: RECORDED_V8,
    ruleVersion: 9,
    label: "通道突破基线 · 每个突破阶段仅首次机会",
    management: "反向 160 根通道退出",
    costFilter: "成本门槛关闭",
    staged: false,
    slowEma: false,
    backgroundMinutes: null,
    channelConfig: { tradeMinutes: 30, entryBars: 320, exitBars: 160 },
  },
  {
    config: RECORDED_V9,
    ruleVersion: 10,
    label: "结构化回调研究",
    management: "连续动态 ATR 跟踪 · 无保本门槛",
    costFilter: "成本门槛关闭",
    staged: false,
    slowEma: false,
    backgroundMinutes: null,
    channelConfig: undefined,
  },
  {
    config: createTrendConfig(),
    ruleVersion: 11,
    label: "通道突破",
    management: "反向 10 根通道退出",
    costFilter: "成本门槛关闭",
    staged: false,
    slowEma: false,
    backgroundMinutes: 1440,
    channelConfig: { tradeMinutes: 240, entryBars: 20, exitBars: 10 },
  },
];

describe("frozen config display across versions", () => {
  it.each(cases)(
    "keeps rule $ruleVersion labels, costs and available fields unchanged",
    ({ config, ...expected }) => {
      const bytes = JSON.stringify(config);
      validateRecordedTrendConfig(config);
      const view = trendRunView({ config } as TrendRun);
      expect(view).toMatchObject(expected);
      expect(view.priceAction).toEqual(
        config.version === 7 ? { keyLevel: true, twoLegs: false } : undefined,
      );
      expect(view.structuredPullback).toEqual(
        config.version === 9 ? { keyLevel: "either", shape: "any", candle: "none" } : undefined,
      );
      expect(view.execution).toEqual(config.execution);
      expect(view.archived).toBe(false);
      expect(JSON.stringify(config)).toBe(bytes);
    },
  );

  it("does not infer optional policies merely because a version supports them", () => {
    for (const version of [8, 9, 10] as const) {
      const config = { ...structuredClone(RECORDED_V8), version };
      delete config.strategy.breakoutReentry;
      delete config.strategy.channelExitBars;
      config.strategy.maxCostAtr = 0.25;
      validateRecordedTrendConfig(config);
      const view = trendRunView({ config } as TrendRun);
      expect(view.label).toBe("通道突破基线");
      expect(view.channelConfig).toEqual({ tradeMinutes: 30, entryBars: 320, exitBars: 160 });
      expect(view.costFilter).toBe("往返成本 ≤ 0.25 ATR");
      expect(view.staged).toBe(false);
      expect(view.priceAction).toBeUndefined();
      expect(view.structuredPullback).toBeUndefined();
    }
  });
});
