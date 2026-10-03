import {
  createTrendConfig,
  TREND_PERIODS,
  STRUCTURED_PULLBACK_OPTIONS,
  TREND_RULES,
  TREND_BACKGROUND_RULES,
  TREND_PRICE_ACTION_RULES,
  backgroundMinutes,
  periodLabel,
  trendWarmupDays,
  withTradingPeriod,
  validateTrendConfig,
  defaultTrendPreset,
  simpleChannelConfig,
  kdjResearchConfig,
  priceActionResearchConfig,
  structuredPullbackResearchConfig,
  withTrendEntry,
  withTrendManagement,
  managementLabel,
  type TrendConfig,
} from "@bcr/quant-core/trend";
import { Button, Dialog, Input, Select } from "@bcr/react";
import { useState } from "react";

type Section = "strategy" | "execution" | "risk";
const sections: [Section, string][] = [
  ["strategy", "策略"],
  ["execution", "成交"],
  ["risk", "风控"],
];
function NumberField({
  label,
  value,
  step = 0.1,
  onChange,
}: {
  label: string;
  value: number;
  step?: number;
  onChange: (value: number) => void;
}) {
  return (
    <label>
      {label}
      <Input
        aria-label={label}
        type="number"
        step={step}
        value={Number.isFinite(value) ? value : ""}
        onChange={(e) => onChange(e.target.valueAsNumber)}
      />
    </label>
  );
}
interface SettingsProps {
  open: boolean;
  onClose: () => void;
  config: TrendConfig;
  onChange: (config: TrendConfig) => void;
}
export function TrendSettings(props: SettingsProps) {
  return props.open ? <SettingsForm {...props} /> : null;
}
function SettingsForm({ open, onClose, config, onChange }: SettingsProps) {
  const [draft, setDraft] = useState(() => structuredClone(config));
  const [section, setSection] = useState<Section>("strategy");
  const strategy = (patch: Partial<TrendConfig["strategy"]>) =>
    setDraft((c) => ({ ...c, strategy: { ...c.strategy, ...patch } }));
  const execution = (patch: Partial<TrendConfig["execution"]>) =>
    setDraft((c) => ({ ...c, execution: { ...c.execution, ...patch } }));
  const risk = (patch: Partial<TrendConfig["risk"]>) =>
    setDraft((c) => ({ ...c, risk: { ...c.risk, ...patch } }));
  const { strategy: s, execution: e, risk: r } = draft;
  let error = "";
  try {
    validateTrendConfig(draft);
  } catch (e) {
    error = String(e);
  }
  return (
    <Dialog open={open} onClose={onClose} title="趋势研究设置" className="trend-settings">
      <nav className="trend-settings-tabs" aria-label="设置分类">
        {sections.map(([key, name]) => (
          <Button
            key={key}
            variant={section === key ? "default" : "ghost"}
            aria-pressed={section === key}
            onClick={() => setSection(key)}
          >
            {name}
          </Button>
        ))}
      </nav>
      {section === "strategy" && (
        <section aria-label="策略设置">
          <p className="trend-help">
            完整交易 K 线收盘确认信号，下一分钟开盘尝试入场。初始止损使用信号 ATR 14；
            {s.management === "channel"
              ? "初始硬止损在持仓期间保持固定。"
              : "保本与跟踪止损只向收紧风险的方向调整。"}
          </p>
          <div className="trend-fields">
            <Button variant="ghost" size="sm" onClick={() => setDraft(defaultTrendPreset(draft))}>
              使用默认趋势方案 · 4 小时 / 日线背景
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setDraft(simpleChannelConfig(draft))}>
              使用无过滤基线 · 4 小时 / 仅做多
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setDraft(kdjResearchConfig(draft))}>
              KDJ 回调研究 · 5 分钟 / 双向
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setDraft(priceActionResearchConfig(draft))}
            >
              价格行为回调研究 · 5 分钟 / 双向
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setDraft(structuredPullbackResearchConfig(draft))}
            >
              结构化回调研究 · 30 分钟 / 双向
            </Button>
          </div>
          <p className="trend-help">
            前两个方案使用 20 根突破、仅做多与反向通道退出，只在背景过滤上不同。
            预设保留当前资金、成交成本和成本门槛；结构化回调预设关闭 UTC
            日亏损保护，其余风控保留。点击“应用设置”后生效。
          </p>
          <label className="trend-context-setting">
            入场环境
            <Select
              aria-label="入场环境"
              value={s.filter}
              onChange={(event) => strategy({ filter: event.target.value as typeof s.filter })}
            >
              <option value="background">趋势背景 · 自动较大周期</option>
              <option value="none">无过滤基线</option>
              <option value="ema">同周期 EMA 20 / 60</option>
              <option value="slow-ema">同周期 EMA 60 方向与斜率</option>
            </Select>
          </label>
          {s.filter === "slow-ema" && (
            <div className="trend-context-description">
              <strong>EMA 60 · 收盘位置与三根斜率</strong>
              <p>
                收盘在 EMA 60 上方且均线高于三根前时允许做多；下方且均线下降时允许做空。
                仅使用已完成的交易 K 线，至少预热 63 根。
              </p>
            </div>
          )}
          {s.entry === "kdj" && (
            <div className="trend-context-description">
              <strong>KDJ 回调研究 · 截图推测方案</strong>
              <p>
                固定 KDJ 9,3,3，K / D 初值 50，价格平窗时 RSV 为 50。 K 进入 20
                以下后等待金叉做多，进入 80 以上后等待死叉做空；
                每次进入区域只准备一次，后续另一根完整 K 线交叉才可入场；持仓、趋势或风控打断后，
                须先离区再回来，且方向有效。J 只作观察。
              </p>
              <p>
                这是根据截图提出的可检验假设，并非博主规则的精确复现，尚未证明具有扣费后的正期望。
              </p>
            </div>
          )}
          {s.entry === "structured-pullback" && s.structuredPullback && (
            <div className="trend-context-description">
              <strong>趋势能量 → 较大周期关键位 → 回调结构 → 整段极值突破</strong>
              <p>
                推进强度使用推进前 ATR
                归一化，均线辅助判断方向。关键位与结构只使用当时已确认的信息，
                形态可同时命中；收盘越过冻结的整段推进高点或低点后，下一分钟尝试成交。
                这些是可复现的研究假设，尚未证明扣费后具有正期望。
              </p>
              <div className="trend-fields">
                <label>
                  关键位要求
                  <Select
                    aria-label="关键位要求"
                    value={s.structuredPullback.keyLevel}
                    onChange={(event) =>
                      strategy({
                        structuredPullback: {
                          ...s.structuredPullback!,
                          keyLevel: event.target.value as NonNullable<
                            typeof s.structuredPullback
                          >["keyLevel"],
                        },
                      })
                    }
                  >
                    {STRUCTURED_PULLBACK_OPTIONS.keyLevel.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </Select>
                </label>
                <label>
                  回调结构要求
                  <Select
                    aria-label="回调结构要求"
                    value={s.structuredPullback.shape}
                    onChange={(event) =>
                      strategy({
                        structuredPullback: {
                          ...s.structuredPullback!,
                          shape: event.target.value as NonNullable<
                            typeof s.structuredPullback
                          >["shape"],
                        },
                      })
                    }
                  >
                    {STRUCTURED_PULLBACK_OPTIONS.shape.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </Select>
                </label>
                <label>
                  结构确认时点
                  <Select
                    aria-label="结构确认时点"
                    value={s.structuredPullback.confirmation}
                    onChange={(event) =>
                      strategy({
                        structuredPullback: {
                          ...s.structuredPullback!,
                          confirmation: event.target.value as NonNullable<
                            typeof s.structuredPullback
                          >["confirmation"],
                        },
                      })
                    }
                  >
                    {STRUCTURED_PULLBACK_OPTIONS.confirmation.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </Select>
                </label>
                <label>
                  关键位用途
                  <Select
                    aria-label="关键位用途"
                    value={s.structuredPullback.keyRole}
                    onChange={(event) =>
                      strategy({
                        structuredPullback: {
                          ...s.structuredPullback!,
                          keyRole: event.target.value as NonNullable<
                            typeof s.structuredPullback
                          >["keyRole"],
                        },
                      })
                    }
                  >
                    {STRUCTURED_PULLBACK_OPTIONS.keyRole.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </Select>
                </label>
                <label>
                  K 线确认
                  <Select
                    aria-label="K 线确认"
                    value={s.structuredPullback.candle}
                    onChange={(event) =>
                      strategy({
                        structuredPullback: {
                          ...s.structuredPullback!,
                          candle: event.target.value as NonNullable<
                            typeof s.structuredPullback
                          >["candle"],
                        },
                      })
                    }
                  >
                    {STRUCTURED_PULLBACK_OPTIONS.candle.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </Select>
                </label>
              </div>
              <p>
                较大周期为{periodLabel(backgroundMinutes(s.tradeMinutes))}，摆动点在右侧完整 K
                线确认后才可使用。 “任一结构”要求至少一种形态；“不设结构门槛”仅供机制对照。 外包 K
                线与实体吞没分别记录，十字星本身不等于方向反转。
              </p>
              <p>
                “突破收盘确认”允许该根完成结构确认，成交仍在下一分钟。
                “推进背景”使用推进起点已知的摆动点及后续推进突破，或起点前已两次验证、起点收盘在顺侧的
                EMA；
                无需本次回踩，但关键位被反向收盘越过容差后仍会失效。预设保留突破前确认与回调重测。
              </p>
            </div>
          )}
          {s.entry === "price-action" && s.priceAction && (
            <div className="trend-context-description">
              <strong>强推进 → 回调 → 突破整段推进极值</strong>
              <p>
                以价格结构定义入场，信号收盘确认后下一分钟尝试成交。两个开关只用于比较机制的作用，
                不是寻找最优参数；本方案尚未证明扣费后具有正期望，也不代表作者原规则。
              </p>
              <div className="trend-fields">
                <label className="trend-mechanism-toggle">
                  <input
                    type="checkbox"
                    checked={s.priceAction.keyLevel}
                    onChange={(event) =>
                      strategy({
                        priceAction: { ...s.priceAction!, keyLevel: event.target.checked },
                      })
                    }
                  />
                  要求较大周期关键位回踩
                </label>
                <label className="trend-mechanism-toggle">
                  <input
                    type="checkbox"
                    checked={s.priceAction.twoLegs}
                    onChange={(event) =>
                      strategy({
                        priceAction: { ...s.priceAction!, twoLegs: event.target.checked },
                      })
                    }
                  />
                  要求至少两腿回调
                </label>
              </div>
              <details>
                <summary>固定价格行为规则</summary>
                <p>
                  推进前 ATR 14 冻结为基准；{TREND_PRICE_ACTION_RULES.impulseBars} 根净位移 ≥{" "}
                  {TREND_PRICE_ACTION_RULES.impulseAtr} 倍基准 ATR，方向效率 ≥{" "}
                  {TREND_PRICE_ACTION_RULES.minEfficiency * 100}%。确认后最多再延伸{" "}
                  {TREND_PRICE_ACTION_RULES.maxExtensionBars}{" "}
                  根，首次逆向收盘冻结整段极值，包含该根高低价。 回调{" "}
                  {TREND_PRICE_ACTION_RULES.minPullbackBars}–
                  {TREND_PRICE_ACTION_RULES.maxPullbackBars} 根、 深度{" "}
                  {TREND_PRICE_ACTION_RULES.minRetracement * 100}–
                  {TREND_PRICE_ACTION_RULES.maxRetracement * 100}%，
                  收盘越过整段极值至少一跳才触发，不使用回调内部局部高点。
                </p>
                <p>
                  关键位取推进起点前已确认的最近{periodLabel(backgroundMinutes(s.tradeMinutes))}
                  摆动点， 左右各 {TREND_PRICE_ACTION_RULES.pivotRadius} 根确认。最初 3
                  根确认时须已突破该关键位，延伸阶段才突破不纳入。多头回调低点须进入前高 ±{" "}
                  {TREND_PRICE_ACTION_RULES.keyLevelToleranceAtr} 倍基准 ATR
                  区域且收盘回到上方；空头反向。收盘越过容差区逆向边界后关键位失效，不再恢复。
                </p>
                <p>
                  多头从逆向收盘开始第一腿，之后新 K 收盘越过前根高点一跳转为反弹， 再由后续新 K
                  收盘跌破前根低点一跳确认第二腿；空头反向，每根最多转换一次。 两腿不是两根 K
                  线。首次突破即消费形态，机制不满足也不会等待第二次突破。 初始止损仍使用信号当时
                  ATR，与推进前冻结基准分别记录。
                </p>
              </details>
            </div>
          )}
          {s.filter === "none" && s.entry === "breakout" && (
            <div className="trend-context-description">
              <strong>
                无过滤基线 · 最近 {s.breakoutBars} 根 × {periodLabel(s.tradeMinutes)}
              </strong>
              <p>
                突破只比较此前这个窗口的最高价或最低价，不会排除更大范围的震荡。
                {s.breakoutReentry === "episode"
                  ? "同一突破阶段仅取首次机会；后续收盘回到冻结边界后才重新允许触发。"
                  : "离场后，只要再次满足突破和风控条件，就可能重新入场。"}
              </p>
            </div>
          )}
          {s.filter === "background" && (
            <div className="trend-context-description">
              <strong>
                {periodLabel(backgroundMinutes(s.tradeMinutes))}背景 → {periodLabel(s.tradeMinutes)}
                入场
              </strong>
              <p>
                使用已收盘的{periodLabel(backgroundMinutes(s.tradeMinutes))} K 线，检查方向效率、
                EMA 方向和已确认的摆动结构，拒绝方向效率不足、逆势或结构失效的入场。
                过滤只影响新开仓，不能排除所有震荡，也可能错过趋势启动。每次判断随结果保存。
              </p>
              <details>
                <summary>固定背景规则</summary>
                <p>
                  EMA {TREND_BACKGROUND_RULES.emaPeriod} 与 {TREND_BACKGROUND_RULES.slopeBars}{" "}
                  根斜率；
                  {TREND_BACKGROUND_RULES.window} 根方向效率 ≥{" "}
                  {TREND_BACKGROUND_RULES.minEfficiency * 100}%； 摆动点在后续{" "}
                  {TREND_BACKGROUND_RULES.pivotRadius} 根收盘后确认。
                  均线偏离只作诊断，不拦截持续推进。 这些是待验证的趋势延续规则。
                </p>
              </details>
            </div>
          )}
          <div className="trend-fields trend-primary-fields">
            <label>
              持仓管理
              <Select
                aria-label="持仓管理"
                value={s.management}
                onChange={(event) =>
                  setDraft(withTrendManagement(draft, event.target.value as typeof s.management))
                }
              >
                <option value="atr">保本与 ATR 移动止盈</option>
                <option value="channel">
                  {s.channelExitBars === undefined ? "反向通道退出 · 自动窗口" : managementLabel(s)}
                </option>
                <option value="staged">收盘 R 分段保护 · 动态 ATR</option>
                <option value="chandelier">连续动态 ATR 跟踪 · 无保本门槛</option>
              </Select>
            </label>
            <label>
              交易周期
              <Select
                aria-label="交易周期"
                value={s.tradeMinutes}
                onChange={(event) => setDraft(withTradingPeriod(draft, Number(event.target.value)))}
              >
                {TREND_PERIODS.map((m) => (
                  <option key={m} value={m}>
                    {periodLabel(m)}
                  </option>
                ))}
              </Select>
            </label>
            {s.entry === "breakout" && (
              <NumberField
                label="突破窗口 · 根 K 线"
                value={s.breakoutBars}
                step={1}
                onChange={(n) => strategy({ breakoutBars: n })}
              />
            )}
            <NumberField
              label="初始止损 · ATR"
              value={s.stopAtr}
              onChange={(n) => strategy({ stopAtr: n })}
            />
            {s.management === "staged" && s.staged && (
              <>
                <NumberField
                  label="保本触发 · 收盘 R（0 关闭）"
                  value={s.staged.breakEvenR}
                  onChange={(n) => strategy({ staged: { ...s.staged!, breakEvenR: n } })}
                />
                <NumberField
                  label="跟踪启动 · 收盘 R（0 不亏时启动）"
                  value={s.staged.trailingStartR}
                  onChange={(n) => strategy({ staged: { ...s.staged!, trailingStartR: n } })}
                />
              </>
            )}
            {s.management === "atr" && (
              <NumberField
                label="保本触发 · ATR（0 关闭）"
                value={s.breakEvenAtr}
                onChange={(n) => strategy({ breakEvenAtr: n })}
              />
            )}
            {s.management !== "channel" && (
              <NumberField
                label="移动止盈距离 · ATR"
                value={s.trailingAtr}
                onChange={(n) => strategy({ trailingAtr: n })}
              />
            )}
            <NumberField
              label="往返成本上限 · ATR（0 关闭）"
              value={s.maxCostAtr}
              onChange={(n) => strategy({ maxCostAtr: n })}
            />
            <NumberField
              label="每笔风险 · %"
              value={r.riskPct * 100}
              onChange={(n) => risk({ riskPct: n / 100 })}
            />
          </div>
          <p className="trend-help">
            成本门槛独立于入场环境，适用于所有过滤模式。估算双边手续费、滑点与价格取整，占信号 ATR
            的比例超过上限时拒绝入场；不预测未来资金费。设为 0 仅关闭门槛，回测仍扣除成本。
          </p>
          <p className="trend-help">
            {s.management === "channel"
              ? `ATR 硬止损在入场时冻结；${managementLabel(s)}，只用此前完整 K 线，收盘确认后下一分钟开盘退出。不设主动保本与移动距离参数。`
              : s.management === "chandelier"
                ? "初始止损按信号 ATR 冻结；从入场后的第一根完整交易 K 线开始，以持仓以来极值和当前 ATR 14 计算保护线，只收紧、不放宽。没有盈利启动阈值或主动保本；保护线越过收盘时，锁定下一分钟开盘退出。"
                : s.management === "staged"
                  ? "R 使用成交价到初始止损的固定距离。完整交易 K 线收盘达到阈值后锁定保本或跟踪状态；跟踪采用当前 ATR 14 与入场以来极值，止损只收紧。新保护线越过收盘时锁定退出意图，下分钟开盘成交。保本覆盖已知成本，跳空与后续资金费仍可能亏损。"
                  : "ATR 在信号收盘时冻结；保本覆盖费用、滑点和已结算资金费。移动止盈跟随持仓最高 / 最低价，不另设启动阈值。"}
          </p>
          <details className="trend-variants">
            <summary>研究变体</summary>
            <div className="trend-fields">
              <label>
                入场规则
                <Select
                  aria-label="入场规则"
                  value={s.entry}
                  disabled={s.management === "channel"}
                  onChange={(event) =>
                    setDraft(withTrendEntry(draft, event.target.value as typeof s.entry))
                  }
                >
                  <option value="breakout">通道突破基线</option>
                  <option value="pullback">回调突破 · 固定规则</option>
                  <option value="kdj">KDJ 回调研究</option>
                  <option value="price-action">价格行为回调研究</option>
                  <option value="structured-pullback">结构化回调研究</option>
                </Select>
              </label>
              <label>
                交易方向
                <Select
                  aria-label="交易方向"
                  value={s.direction}
                  onChange={(event) =>
                    strategy({ direction: event.target.value as typeof s.direction })
                  }
                >
                  <option value="both">双向</option>
                  <option value="long">仅做多</option>
                  <option value="short">仅做空</option>
                </Select>
              </label>
            </div>
            <p className="trend-help">
              同周期 EMA 使用 20 / 60 排列与快线三根斜率。背景只约束新开仓，
              持仓保护持续执行。变体共享成交与风控设置，便于逐项比较。
            </p>
            {s.entry === "pullback" && (
              <p className="trend-help">
                固定规则：{TREND_RULES.impulseBars} 根推进 ≥ {TREND_RULES.impulseAtr} ATR，方向效率
                ≥ {TREND_RULES.minEfficiency * 100}%，回调 {TREND_RULES.minPullbackBars}–
                {TREND_RULES.maxPullbackBars} 根、深度 {TREND_RULES.minRetracement * 100}–
                {TREND_RULES.maxRetracement * 100}%，突破推进极值入场。这些是研究假设。
              </p>
            )}
          </details>
          <p className="trend-help">
            预热 {trendWarmupDays(draft)} 天 · 规则版本 11 · 信号、背景、止损与仓位由确定规则执行。
          </p>
        </section>
      )}
      {section === "execution" && (
        <section aria-label="成交设置">
          <p className="trend-help">单独记录资金、成本和合约精度，随每次结果冻结保存。</p>
          <div className="trend-fields">
            <NumberField
              label="初始资金 · USDT"
              value={e.initialCapital}
              step={100}
              onChange={(n) => execution({ initialCapital: n })}
            />
            <NumberField
              label="单边手续费 · bps"
              value={e.feeBps}
              onChange={(n) => execution({ feeBps: n })}
            />
            <NumberField
              label="单边滑点 · bps"
              value={e.slippageBps}
              onChange={(n) => execution({ slippageBps: n })}
            />
            <NumberField
              label="最小价格步长"
              value={e.tickSize}
              step={0.01}
              onChange={(n) => execution({ tickSize: n })}
            />
            <NumberField
              label="最小数量步长"
              value={e.quantityStep}
              step={0.001}
              onChange={(n) => execution({ quantityStep: n })}
            />
            <NumberField
              label="最小订单名义价值 · USDT"
              value={e.minNotional}
              step={1}
              onChange={(n) => execution({ minNotional: n })}
            />
          </div>
          <p className="trend-help">
            费用和精度为研究假设，需要按标的设置。资金费使用官方历史费率和所在分钟的开盘标记价格。
          </p>
        </section>
      )}
      {section === "risk" && (
        <section aria-label="风控设置">
          <p className="trend-help">
            风控独立于入场规则。连续亏损按扣除费用与资金费后的净收益统计，跨 UTC 日期保留冷却。
          </p>
          <div className="trend-fields">
            <NumberField
              label="最大名义敞口 · %"
              value={r.maxExposurePct * 100}
              step={1}
              onChange={(n) => risk({ maxExposurePct: n / 100 })}
            />
            <NumberField
              label="连续净亏损次数（0 关闭）"
              value={r.cooldownLosses}
              step={1}
              onChange={(n) => risk({ cooldownLosses: n })}
            />
            <NumberField
              label="暂停开仓 · 分钟"
              value={r.cooldownMinutes}
              step={1}
              onChange={(n) => risk({ cooldownMinutes: n })}
            />
            <NumberField
              label="单日亏损限制 · %（0 关闭）"
              value={r.dailyLossPct * 100}
              onChange={(n) => risk({ dailyLossPct: n / 100 })}
            />
            <label>
              持仓时间
              <Select
                aria-label="持仓时间"
                disabled={s.tradeMinutes === 1440}
                value={r.flattenMinute === null ? "continuous" : "daily"}
                onChange={(event) =>
                  risk({ flattenMinute: event.target.value === "daily" ? 1437 : null })
                }
              >
                <option value="continuous">允许跨日持仓</option>
                <option value="daily">UTC 每日定时平仓</option>
              </Select>
            </label>
            {r.flattenMinute !== null && (
              <label>
                UTC 平仓时间
                <Input
                  aria-label="UTC 平仓时间"
                  type="time"
                  value={`${String(Math.floor(r.flattenMinute / 60)).padStart(2, "0")}:${String(r.flattenMinute % 60).padStart(2, "0")}`}
                  onChange={(event) => {
                    const [h, m] = event.target.value.split(":").map(Number);
                    risk({ flattenMinute: event.target.value ? h! * 60 + m! : null });
                  }}
                />
              </label>
            )}
          </div>
          <p className="trend-help">
            Binance 全天交易，默认没有尾盘强平。每日限制按 UTC 统计；敞口不超过资金的
            100%，当前不模拟交易所强平与 ADL。
          </p>
        </section>
      )}
      {error && (
        <p role="alert" className="trend-error">
          {error}
        </p>
      )}
      <div className="trend-dialog-actions">
        <Button variant="ghost" onClick={() => setDraft(createTrendConfig())}>
          恢复默认
        </Button>
        <div>
          <Button variant="ghost" onClick={onClose}>
            取消
          </Button>
          <Button
            variant="primary"
            disabled={!!error}
            onClick={() => {
              onChange(draft);
              onClose();
            }}
          >
            应用设置
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
