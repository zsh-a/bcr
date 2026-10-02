import {
  createTrendConfig,
  TREND_PERIODS,
  TREND_RULES,
  periodLabel,
  trendWarmupDays,
  withTradingPeriod,
  validateTrendConfig,
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
            收盘确认突破，下一分钟开盘尝试入场。用固定 ATR 14 控制风险，止损只向盈利方向移动。
          </p>
          <div className="trend-fields trend-primary-fields">
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
            <NumberField
              label="保本触发 · ATR（0 关闭）"
              value={s.breakEvenAtr}
              onChange={(n) => strategy({ breakEvenAtr: n })}
            />
            <NumberField
              label="移动止盈距离 · ATR"
              value={s.trailingAtr}
              onChange={(n) => strategy({ trailingAtr: n })}
            />
            <NumberField
              label="每笔风险 · %"
              value={r.riskPct * 100}
              onChange={(n) => risk({ riskPct: n / 100 })}
            />
          </div>
          <p className="trend-help">
            ATR 在信号收盘时冻结；保本覆盖费用、滑点和已结算资金费。移动止盈跟随持仓最高 /
            最低价，不另设启动阈值。
          </p>
          <details className="trend-variants">
            <summary>研究变体</summary>
            <div className="trend-fields">
              <label>
                入场规则
                <Select
                  aria-label="入场规则"
                  value={s.entry}
                  onChange={(event) => strategy({ entry: event.target.value as typeof s.entry })}
                >
                  <option value="breakout">通道突破基线</option>
                  <option value="pullback">回调突破 · 固定规则</option>
                </Select>
              </label>
              <label>
                方向过滤
                <Select
                  aria-label="方向过滤"
                  value={s.filter}
                  onChange={(event) => strategy({ filter: event.target.value as typeof s.filter })}
                >
                  <option value="none">无过滤</option>
                  <option value="ema">EMA 20 / 60 与快线斜率</option>
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
              EMA 只使用已收盘的交易周期 K 线。变体共享相同成交与风控设置，便于逐项比较。
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
            预热 {trendWarmupDays(draft)} 天 · 规则版本 3 · 信号、止损与仓位由确定规则执行。
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
