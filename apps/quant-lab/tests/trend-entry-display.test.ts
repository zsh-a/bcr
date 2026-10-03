import { MINUTE } from "@bcr/market-data/binance/model";
import { trendEntryEvidence, type TrendTrade } from "@bcr/quant-core/trend";
import { describe, expect, it } from "vitest";
import { trendEntryFields } from "../src/trend/results/entry";

describe("entry evidence display", () => {
  it("displays overlapping causal structures, pivot confirmation and validated EMA without inventing missing evidence", () => {
    const trade = {
      side: "long",
      entryPrice: 112.1,
      entrySignal: {
        time: 30 * MINUTE - 1,
        price: 112,
        atr: 3,
        boundary: 111,
        trigger: {
          kind: "structured-pullback",
          setupId: 9,
          impulseStartTime: 0,
          impulseConfirmedAt: 15 * MINUTE - 1,
          impulseEndTime: 20 * MINUTE - 1,
          pullbackStartedAt: 20 * MINUTE - 1,
          impulseStartPrice: 100,
          impulseExtreme: 111,
          referenceAtr: 2,
          strengthAtr: 4,
          efficiency: 0.8,
          pullbackBars: 8,
          retracement: 0.4,
          shapes: { twoLegs: true, wedge: false, channel: true, doubleTest: true },
          candles: {
            doubleDoji: false,
            narrowRange: false,
            engulfing: false,
            doji: true,
            insideBar: false,
            outsideBar: true,
            reversal: false,
          },
          turns: [{ kind: "low", price: 107, time: 23 * MINUTE - 1, confirmedAt: 25 * MINUTE - 1 }],
          pivot: {
            minutes: 120,
            price: 108,
            pivotTime: -6 * 120 * MINUTE,
            confirmedAt: -4 * 120 * MINUTE,
            retestTime: 25 * MINUTE - 1,
            valid: true,
          },
          ema: {
            minutes: 120,
            period: 20,
            value: 107.5,
            observedAt: -120 * MINUTE,
            validatedAt: -2 * 120 * MINUTE,
            touches: 2,
            retestTime: 26 * MINUTE - 1,
            valid: true,
          },
        },
      },
    } as TrendTrade;
    const fields = trendEntryFields(trendEntryEvidence(trade)!, trade, 0.1);
    expect(fields).toContainEqual({
      label: "已确认回调结构",
      value: "两段回调 · 平行通道 · 双底 / 双顶",
    });
    expect(fields).toContainEqual({ label: "K 线标签", value: "十字星 · 外包 K 线" });
    expect(fields).toContainEqual({ label: "已验证均线", value: "2 小时 EMA 20 · 107.5" });
    expect(fields).toContainEqual({ label: "推进前 ATR 14", value: "2.0" });
    expect(fields).toContainEqual({ label: "信号 ATR 14", value: "3.0" });
    expect(fields).toContainEqual({ label: "越过整段极值", value: "1.0" });
    expect(fields.find((field) => field.label === "转折 1 · 低点")?.value).toContain(" / 确认 ");
    expect(fields.some((field) => field.value === "反转确认")).toBe(false);
    const trigger = trade.entrySignal!.trigger!;
    if (trigger.kind !== "structured-pullback") throw new Error("fixture trigger");
    expect(
      fields.some((field) => /结构确认时点|关键位用途|起点背景资格|并行门槛/u.test(field.label)),
    ).toBe(false);
    trigger.confirmation = "signal-close";
    trigger.keyRole = "impulse-context";
    trigger.contextEligible = { pivot: true, ema: false };
    trigger.gates = { retracement: true, key: false, shape: true, candle: false };
    trigger.pivot!.valid = false;
    const current = trendEntryFields(trendEntryEvidence(trade)!, trade, 0.1);
    expect(current).toContainEqual({ label: "结构确认时点", value: "允许突破 K 线收盘确认" });
    expect(current).toContainEqual({ label: "关键位用途", value: "推进背景 · 不要求本次回踩" });
    expect(current).toContainEqual({
      label: "起点背景资格",
      value: "摆动点 具备 · EMA 不具备（仍受后续失效检查）",
    });
    expect(current).toContainEqual({
      label: "并行门槛（关闭项视为通过）",
      value: "回调 通过 · 关键位 未通过 · 结构 通过 · K 线 未通过",
    });
    expect(current.find((field) => field.label === "关键位回踩")?.value).toContain("已失效");
    delete trigger.ema;
    delete trigger.pivot;
    trigger.turns = [];
    trigger.shapes = { twoLegs: false, wedge: false, channel: false, doubleTest: false };
    const absent = trendEntryFields(trendEntryEvidence(trade)!, trade, 0.1);
    expect(absent).toContainEqual({ label: "已确认回调结构", value: "未命中结构标签" });
    expect(absent).toContainEqual({ label: "已知关键位", value: "未记录" });
    expect(absent.some((field) => /转折|均线/u.test(field.label))).toBe(false);
  });
  it("shows frozen price-action evidence with separate reference and signal ATRs and a whole-impulse boundary", () => {
    const trade = {
      side: "long",
      entryPrice: 112.1,
      entrySignal: {
        time: 20 * MINUTE - 1,
        price: 112,
        atr: 3,
        boundary: 111,
        trigger: {
          kind: "price-action",
          setupId: 3,
          impulseStartTime: 0,
          impulseConfirmedAt: 15 * MINUTE - 1,
          pullbackStartedAt: 16 * MINUTE - 1,
          impulseStartPrice: 100,
          impulseExtreme: 111,
          referenceAtr: 2,
          strengthAtr: 4,
          efficiency: 0.8,
          pullbackBars: 3,
          retracement: 0.3,
          legCount: 2,
          keyLevel: {
            minutes: 30,
            price: 108,
            pivotTime: -90 * MINUTE,
            confirmedAt: -30 * MINUTE - 1,
            retestTime: 18 * MINUTE - 1,
            valid: true,
          },
        },
      },
    } as TrendTrade;
    const fields = trendEntryFields(trendEntryEvidence(trade)!, trade, 0.1);
    expect(fields).toContainEqual({ label: "推进前 ATR 14", value: "2.0" });
    expect(fields).toContainEqual({ label: "信号 ATR 14", value: "3.0" });
    expect(fields).toContainEqual({ label: "推进起点价 / 整段极值", value: "100.0 / 111.0" });
    expect(fields).toContainEqual({ label: "越过整段极值", value: "1.0" });
    expect(fields).toContainEqual({ label: "回调腿结构", value: "至少两腿 · 含反弹确认" });
    expect(fields).toContainEqual({ label: "已知关键位", value: "30 分钟 · 108.0" });
    expect(fields.some((f) => /此前.*根|K \/ D|局部高点/u.test(f.label))).toBe(false);

    const signal = trade.entrySignal!;
    if (signal.trigger?.kind !== "price-action") throw new Error("fixture trigger");
    delete signal.trigger.keyLevel;
    signal.trigger.legCount = 1;
    const ablated = trendEntryFields(trendEntryEvidence(trade)!, trade, 0.1);
    expect(ablated).toContainEqual({ label: "已知关键位", value: "未记录" });
    expect(ablated).toContainEqual({ label: "回调腿结构", value: "一腿" });
    expect(ablated.some((f) => f.label === "关键位回踩")).toBe(false);
  });
  it("shows KDJ arming and crossing snapshots without a price-channel explanation", () => {
    const trade = {
      side: "long",
      entryPrice: 102,
      entrySignal: {
        time: 10 * MINUTE - 1,
        price: 101,
        atr: 2,
        trigger: {
          kind: "kdj-cross",
          armedAt: 5 * MINUTE - 1,
          armedK: 17,
          previousK: 18,
          previousD: 20,
          k: 24,
          d: 22,
          j: 28,
          slowEma: 100,
          slowEma3Ago: 99,
        },
      },
    } as TrendTrade;
    const evidence = trendEntryEvidence(trade)!;
    const fields = trendEntryFields(evidence, trade, 0.01);
    expect(fields.map((field) => field.label)).toEqual([
      "信号收盘",
      "回调进入区域",
      "前根 K / D",
      "金叉 K / D / J",
      "EMA 60 / 三根前",
      "下一分钟成交",
      "信号 ATR 14",
    ]);
    expect(fields.find((field) => field.label === "金叉 K / D / J")?.value).toBe(
      "24.00 / 22.00 / 28.00",
    );
    expect(evidence.boundary).toBeUndefined();
    expect(
      trendEntryFields(evidence, { ...trade, side: "short" }, 0.01).some(
        (field) => field.label === "死叉 K / D / J",
      ),
    ).toBe(true);
  });
  it("keeps legacy price-breakout evidence and does not invent an oscillator or missing ATR", () => {
    const fields = trendEntryFields(
      {
        source: "derived",
        time: 0,
        price: 98,
        boundary: 100,
        lookbackBars: 20,
        atr: undefined,
        trigger: undefined,
      },
      { side: "short", entryPrice: 97.95 },
      0.01,
    );
    expect(fields).toContainEqual({ label: "此前 20 根最低价", value: "100.00" });
    expect(fields).toContainEqual({ label: "突破幅度", value: "2.00" });
    expect(
      fields.some((field) => field.label.includes("K / D") || field.label.includes("ATR")),
    ).toBe(false);
  });
});
