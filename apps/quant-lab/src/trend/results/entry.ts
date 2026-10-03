import { periodLabel, type trendEntryEvidence, type TrendTrade } from "@bcr/quant-core/trend";
import { number, timestamp } from "./evaluation";
import { priceDigits } from "./format";

/** Display only evidence recorded for this trigger; oscillator values are never price boundaries. */
export function trendEntryFields(
  evidence: NonNullable<ReturnType<typeof trendEntryEvidence>>,
  trade: Pick<TrendTrade, "side" | "entryPrice">,
  tickSize: number,
): { label: string; value: string }[] {
  const price = (value: number) => number(value, priceDigits(tickSize));
  const fields = [{ label: "信号收盘", value: price(evidence.price) }];
  const trigger = evidence.trigger;
  if (trigger?.kind === "kdj-cross") {
    fields.push(
      {
        label: "回调进入区域",
        value: `${timestamp(trigger.armedAt)} · K ${number(trigger.armedK)}`,
      },
      { label: "前根 K / D", value: `${number(trigger.previousK)} / ${number(trigger.previousD)}` },
      {
        label: `${trade.side === "long" ? "金叉" : "死叉"} K / D / J`,
        value: `${number(trigger.k)} / ${number(trigger.d)} / ${number(trigger.j)}`,
      },
    );
    if (trigger.slowEma !== undefined)
      fields.push({
        label: "EMA 60 / 三根前",
        value: `${price(trigger.slowEma)} / ${trigger.slowEma3Ago === undefined ? "—" : price(trigger.slowEma3Ago)}`,
      });
  } else if (trigger?.kind === "price-action" || trigger?.kind === "structured-pullback") {
    fields.push(
      { label: "形态编号", value: String(trigger.setupId) },
      {
        label: "推进起点 / 确认",
        value: `${timestamp(trigger.impulseStartTime)} / ${timestamp(trigger.impulseConfirmedAt)}`,
      },
      {
        label: "推进起点价 / 整段极值",
        value: `${price(trigger.impulseStartPrice)} / ${price(trigger.impulseExtreme)}`,
      },
      { label: "推进前 ATR 14", value: price(trigger.referenceAtr) },
      {
        label: "确认强度 / 方向效率",
        value: `${number(trigger.strengthAtr)} ATR / ${number(trigger.efficiency * 100, 1)}%`,
      },
      {
        label: "回调开始",
        value:
          trigger.pullbackStartedAt === undefined ? "未开始" : timestamp(trigger.pullbackStartedAt),
      },
      {
        label: "回调根数 / 深度",
        value: `${trigger.pullbackBars} 根 / ${number(trigger.retracement * 100, 1)}%`,
      },
    );
    if (trigger.kind === "price-action") {
      fields.push({
        label: "回调腿结构",
        value: trigger.legCount === 2 ? "至少两腿 · 含反弹确认" : "一腿",
      });
    } else {
      if (trigger.confirmation !== undefined)
        fields.push({
          label: "结构确认时点",
          value:
            trigger.confirmation === "signal-close"
              ? "允许突破 K 线收盘确认"
              : "突破 K 线之前已确认",
        });
      if (trigger.keyRole !== undefined)
        fields.push({
          label: "关键位用途",
          value:
            trigger.keyRole === "impulse-context"
              ? "推进背景 · 不要求本次回踩"
              : "本次回调重新测试",
        });
      if (trigger.contextEligible)
        fields.push({
          label: "起点背景资格",
          value: `摆动点 ${trigger.contextEligible.pivot ? "具备" : "不具备"} · EMA ${trigger.contextEligible.ema ? "具备" : "不具备"}（仍受后续失效检查）`,
        });
      if (trigger.gates) {
        const labels = { retracement: "回调", key: "关键位", shape: "结构", candle: "K 线" };
        fields.push({
          label: "并行门槛（关闭项视为通过）",
          value: Object.entries(labels)
            .map(
              ([key, label]) =>
                `${label} ${trigger.gates![key as keyof typeof labels] ? "通过" : "未通过"}`,
            )
            .join(" · "),
        });
      }
      const shapeLabels = {
        twoLegs: "两段回调",
        wedge: "三推楔形",
        channel: "平行通道",
        doubleTest: "双底 / 双顶",
      };
      const candleLabels = {
        doubleDoji: "双十字星",
        narrowRange: "窄幅整理",
        engulfing: "实体吞没",
        doji: "十字星",
        insideBar: "内包 K 线",
        outsideBar: "外包 K 线",
        reversal: "反转确认",
      };
      fields.push(
        { label: "推进末根收盘", value: timestamp(trigger.impulseEndTime) },
        {
          label: "已确认回调结构",
          value:
            Object.entries(shapeLabels)
              .filter(([key]) => trigger.shapes[key as keyof typeof shapeLabels])
              .map(([, label]) => label)
              .join(" · ") || "未命中结构标签",
        },
        {
          label: "K 线标签",
          value:
            Object.entries(candleLabels)
              .filter(([key]) => trigger.candles[key as keyof typeof candleLabels])
              .map(([, label]) => label)
              .join(" · ") || "未命中形态标签",
        },
      );
      for (const [index, turn] of trigger.turns.entries())
        fields.push({
          label: `转折 ${index + 1} · ${turn.kind === "high" ? "高点" : "低点"}`,
          value: `${price(turn.price)} · ${timestamp(turn.time)} / 确认 ${timestamp(turn.confirmedAt)}`,
        });
      if (trigger.ema) {
        const ema = trigger.ema;
        fields.push(
          {
            label: "已验证均线",
            value: `${periodLabel(ema.minutes)} EMA ${ema.period} · ${price(ema.value)}`,
          },
          {
            label: "均线观测 / 验证",
            value: `${timestamp(ema.observedAt)} / ${timestamp(ema.validatedAt)} · ${ema.touches} 次支撑 / 阻力确认`,
          },
          {
            label: "均线回踩",
            value: `${ema.retestTime === undefined ? "未记录回踩" : timestamp(ema.retestTime)} · ${ema.valid ? "有效" : "已失效"}`,
          },
        );
      }
    }
    const level = trigger.kind === "price-action" ? trigger.keyLevel : trigger.pivot;
    if (level) {
      fields.push(
        { label: "已知关键位", value: `${periodLabel(level.minutes)} · ${price(level.price)}` },
        {
          label: "摆动点 / 确认",
          value: `${timestamp(level.pivotTime)} / ${timestamp(level.confirmedAt)}`,
        },
        {
          label: "关键位回踩",
          value: `${level.retestTime === undefined ? "未记录回踩" : timestamp(level.retestTime)} · ${level.valid ? "有效" : "已失效"}`,
        },
      );
    } else fields.push({ label: "已知关键位", value: "未记录" });
    if (evidence.boundary !== undefined)
      fields.push({
        label: "越过整段极值",
        value: price((evidence.price - evidence.boundary) * (trade.side === "long" ? 1 : -1)),
      });
  } else if (evidence.boundary !== undefined) {
    fields.push(
      {
        label: evidence.lookbackBars
          ? `此前 ${evidence.lookbackBars} 根${trade.side === "long" ? "最高" : "最低"}价`
          : "推进极值",
        value: price(evidence.boundary),
      },
      {
        label: "突破幅度",
        value: price((evidence.price - evidence.boundary) * (trade.side === "long" ? 1 : -1)),
      },
    );
  }
  fields.push({ label: "下一分钟成交", value: price(trade.entryPrice) });
  if (evidence.atr !== undefined) fields.push({ label: "信号 ATR 14", value: price(evidence.atr) });
  return fields;
}
