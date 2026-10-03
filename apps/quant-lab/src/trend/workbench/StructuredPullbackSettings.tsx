import {
  backgroundMinutes,
  periodLabel,
  STRUCTURED_PULLBACK_VALUES,
  type StructuredPullbackPolicy,
} from "@bcr/quant-core/trend";
import { Select } from "@bcr/react";
import { STRUCTURED_PULLBACK_LABELS } from "./structured-pullback-labels";

interface StructuredPullbackSettingsProps {
  policy: StructuredPullbackPolicy;
  tradeMinutes: number;
  onChange: (policy: StructuredPullbackPolicy) => void;
}

/** Edits only this entry policy; the parent owns the draft, validation and application. */
export function StructuredPullbackSettings({
  policy,
  tradeMinutes,
  onChange,
}: StructuredPullbackSettingsProps) {
  return (
    <div className="trend-context-description">
      <strong>趋势能量 → 较大周期关键位 → 回调结构 → 整段极值突破</strong>
      <p>
        推进强度使用推进前 ATR 归一化，均线辅助判断方向。关键位与结构只使用当时已确认的信息，
        形态可同时命中；收盘越过冻结的整段推进高点或低点后，下一分钟尝试成交。
        这些是可复现的研究假设，尚未证明扣费后具有正期望。
      </p>
      <div className="trend-fields">
        <label>
          关键位要求
          <Select
            aria-label="关键位要求"
            value={policy.keyLevel}
            onChange={(event) =>
              onChange({
                ...policy,
                keyLevel: event.target.value as StructuredPullbackPolicy["keyLevel"],
              })
            }
          >
            {STRUCTURED_PULLBACK_VALUES.keyLevel.map((value) => (
              <option key={value} value={value}>
                {STRUCTURED_PULLBACK_LABELS.keyLevel[value]}
              </option>
            ))}
          </Select>
        </label>
        <label>
          回调结构要求
          <Select
            aria-label="回调结构要求"
            value={policy.shape}
            onChange={(event) =>
              onChange({
                ...policy,
                shape: event.target.value as StructuredPullbackPolicy["shape"],
              })
            }
          >
            {STRUCTURED_PULLBACK_VALUES.shape.map((value) => (
              <option key={value} value={value}>
                {STRUCTURED_PULLBACK_LABELS.shape[value]}
              </option>
            ))}
          </Select>
        </label>
        <label>
          结构确认时点
          <Select
            aria-label="结构确认时点"
            value={policy.confirmation}
            onChange={(event) =>
              onChange({
                ...policy,
                confirmation: event.target.value as StructuredPullbackPolicy["confirmation"],
              })
            }
          >
            {STRUCTURED_PULLBACK_VALUES.confirmation.map((value) => (
              <option key={value} value={value}>
                {STRUCTURED_PULLBACK_LABELS.confirmation[value]}
              </option>
            ))}
          </Select>
        </label>
        <label>
          关键位用途
          <Select
            aria-label="关键位用途"
            value={policy.keyRole}
            onChange={(event) =>
              onChange({
                ...policy,
                keyRole: event.target.value as StructuredPullbackPolicy["keyRole"],
              })
            }
          >
            {STRUCTURED_PULLBACK_VALUES.keyRole.map((value) => (
              <option key={value} value={value}>
                {STRUCTURED_PULLBACK_LABELS.keyRole[value]}
              </option>
            ))}
          </Select>
        </label>
        <label>
          K 线确认
          <Select
            aria-label="K 线确认"
            value={policy.candle}
            onChange={(event) =>
              onChange({
                ...policy,
                candle: event.target.value as StructuredPullbackPolicy["candle"],
              })
            }
          >
            {STRUCTURED_PULLBACK_VALUES.candle.map((value) => (
              <option key={value} value={value}>
                {STRUCTURED_PULLBACK_LABELS.candle[value]}
              </option>
            ))}
          </Select>
        </label>
      </div>
      <p>
        较大周期为{periodLabel(backgroundMinutes(tradeMinutes))}，摆动点在右侧完整 K
        线确认后才可使用。 “任一结构”要求至少一种形态；“不设结构门槛”仅供机制对照。 外包 K
        线与实体吞没分别记录，十字星本身不等于方向反转。
      </p>
      <p>
        “突破收盘确认”允许该根完成结构确认，成交仍在下一分钟。
        “推进背景”使用推进起点已知的摆动点及后续推进突破，或起点前已两次验证、起点收盘在顺侧的 EMA；
        无需本次回踩，但关键位被反向收盘越过容差后仍会失效。预设保留突破前确认与回调重测。
      </p>
    </div>
  );
}
