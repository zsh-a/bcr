import { ChevronDown, RotateCcw, X } from "lucide-react";
import { Button, Input, Select } from "@bcr/react";
import { useId, useState } from "react";
import { useNames } from "./ResearchNames";
import { displayLabel } from "./display-names";
import { dateText, MODEL, validateConfig, type JsgConfig, type ResearchManifest } from "./model";
import { numericDate } from "./clickhouse-http";

export function configErrors(config: JsgConfig): Record<string, string> {
  const errors: Record<string, string> = {};
  if (
    !Number.isFinite(config.initialCapital) ||
    config.initialCapital <= 0 ||
    config.initialCapital > 1e15
  )
    errors["initialCapital"] = "请输入大于 0 的有效金额";
  if (!Number.isSafeInteger(config.poolSize) || config.poolSize < 1 || config.poolSize > 20_000)
    errors["poolSize"] = "候选池应为 1–20,000 的整数";
  if (
    !Number.isSafeInteger(config.stockCount) ||
    config.stockCount < 1 ||
    config.stockCount > config.poolSize
  )
    errors["stockCount"] = "股票数应为整数，且不超过候选池";
  for (const key of ["commissionBps", "slippageBps"] as const)
    if (!Number.isFinite(config[key]) || config[key] < 0 || config[key] > 100)
      errors[key] = "请输入 0–100 bps 的有效数值";
  for (const key of ["stopLoss", "trailingStop", "maxDrawdown"] as const)
    if (!Number.isFinite(config[key]) || config[key] < 0 || config[key] >= 1)
      errors[key] = "请输入小于 100% 的有效比例";
  try {
    validateConfig(config);
  } catch (error) {
    if (Object.keys(errors).length === 0)
      errors["advanced"] = error instanceof Error ? error.message : String(error);
  }
  return errors;
}
function NumberField({
  label,
  value,
  onChange,
  unit,
  error,
  money = false,
  disabled = false,
  step = 1,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  unit?: string;
  error?: string | undefined;
  money?: boolean;
  disabled?: boolean;
  step?: number;
}) {
  const id = useId();
  const [editing, setEditing] = useState<string | null>(null);
  const display = Number.isFinite(value)
    ? money
      ? new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 }).format(value)
      : String(Number(value.toFixed(8)))
    : "";
  return (
    <label className="research-field" htmlFor={id}>
      <span>{label}</span>
      <div className="research-number">
        <Input
          id={id}
          aria-label={label}
          inputMode="decimal"
          disabled={disabled}
          value={editing ?? display}
          aria-invalid={error !== undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          onFocus={() => setEditing(Number.isFinite(value) ? String(value) : "")}
          onBlur={() => setEditing(null)}
          onChange={(event) => {
            const text = event.currentTarget.value;
            setEditing(text);
            onChange(text.trim() === "" ? NaN : Number(text.replaceAll(",", "")));
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowUp" || event.key === "ArrowDown") {
              event.preventDefault();
              const next =
                (Number.isFinite(value) ? value : 0) + (event.key === "ArrowUp" ? step : -step);
              setEditing(String(next));
              onChange(next);
            }
          }}
        />
        {unit && <small>{unit}</small>}
      </div>
      {error && (
        <small className="research-field-error" id={`${id}-error`}>
          {error}
        </small>
      )}
    </label>
  );
}
export function Parameters({
  config,
  manifest,
  onChange,
  onReset,
  busy,
}: {
  config: JsgConfig;
  manifest?: ResearchManifest | undefined;
  onChange: (patch: Partial<JsgConfig>) => void;
  onReset: () => void;
  busy: boolean;
}) {
  const errors = configErrors(config);
  const names = useNames();
  const industryLabel = (code: string) => displayLabel(names, "industries", code);
  const [industryQuery, setIndustryQuery] = useState("");
  const raw = config.executionModel === "jsg-raw-v2";
  const updateFee = (index: number, patch: Partial<NonNullable<JsgConfig["fees"]>[number]>) =>
    onChange({ fees: config.fees!.map((fee, i) => (i === index ? { ...fee, ...patch } : fee)) });
  return (
    <fieldset className="research-parameters" disabled={busy}>
      <div className="research-panel-heading">
        <div>
          <h2>策略参数</h2>
        </div>
        <Button
          variant="ghost"
          size="sm"
          aria-label="重置策略参数"
          title="重置策略参数"
          onClick={onReset}
        >
          <RotateCcw size={15} />
        </Button>
      </div>
      <div className="research-parameter-group">
        <NumberField
          label="初始本金"
          value={config.initialCapital}
          onChange={(initialCapital) => onChange({ initialCapital })}
          unit="元"
          money
          step={10000}
          error={errors["initialCapital"]}
        />
        <NumberField
          label="候选池大小"
          value={config.poolSize}
          onChange={(poolSize) => onChange({ poolSize })}
          unit="只"
          error={errors["poolSize"]}
        />
        <NumberField
          label="目标股票数"
          value={config.stockCount}
          onChange={(stockCount) => onChange({ stockCount })}
          unit="只"
          error={errors["stockCount"]}
        />
      </div>
      <details className="research-parameter-details">
        <summary>
          交易成本
          <ChevronDown size={14} />
        </summary>
        <NumberField
          label="佣金"
          value={config.commissionBps / 100}
          onChange={(value) => onChange({ commissionBps: value * 100 })}
          unit="%"
          step={0.01}
          error={errors["commissionBps"]}
        />
        <NumberField
          label="滑点 / bps"
          value={config.slippageBps}
          onChange={(slippageBps) => onChange({ slippageBps })}
          unit="bps"
          error={errors["slippageBps"]}
        />
        <p className="research-help">1 bps = 0.01%。费用按实际成交计入。</p>
      </details>
      <details className="research-parameter-details">
        <summary>
          风险控制
          <ChevronDown size={14} />
        </summary>
        {(
          [
            ["stopLoss", "个股止损", 0.1],
            ["trailingStop", "移动止盈", 0.1],
            ["maxDrawdown", "组合回撤", 0.2],
          ] as const
        ).map(([key, label, baseline]) => (
          <div className="research-risk" key={key}>
            <label className="research-switch">
              <input
                type="checkbox"
                aria-label={`启用${label}`}
                checked={config[key] !== 0}
                onChange={(event) =>
                  onChange({ [key]: event.currentTarget.checked ? baseline : 0 })
                }
              />
              <span>{label}</span>
            </label>
            {config[key] !== 0 && (
              <NumberField
                label={`${label} / %`}
                value={config[key] * 100}
                onChange={(value) => onChange({ [key]: value / 100 })}
                unit="%"
                error={errors[key]}
              />
            )}
          </div>
        ))}
        <p className="research-help">风控信号按交易日收盘处理。</p>
      </details>
      <details className="research-parameter-details">
        <summary>
          成交模型与行业
          <ChevronDown size={14} />
        </summary>
        <label className="research-field">
          <span>成交模型</span>
          <Select
            aria-label="成交模型"
            value={config.executionModel ?? MODEL}
            onChange={(event) => {
              const executionModel = event.currentTarget.value as NonNullable<
                JsgConfig["executionModel"]
              >;
              onChange({
                executionModel,
                ...(executionModel === "jsg-raw-v2" && !config.fees?.length
                  ? {
                      fees: [
                        {
                          from: manifest?.startDate ?? 20200101,
                          minimumCommission: 0,
                          transferBps: 0,
                          sellTaxBps: 0,
                        },
                      ],
                    }
                  : {}),
              });
            }}
          >
            <option value={MODEL}>复权研究</option>
            <option value="jsg-raw-v2" disabled={manifest?.version !== 2}>
              原始价格 · 需要完整事件数据
            </option>
          </Select>
        </label>
        <label className="research-switch">
          <input
            type="checkbox"
            checked={raw || config.tPlusOne}
            disabled={raw}
            onChange={(event) => onChange({ tPlusOne: event.currentTarget.checked })}
          />
          <span>T+1 可卖数量约束</span>
        </label>
        <p className="research-help">
          {raw
            ? "原始价格模型固定执行 T+1，公司行动与价格限制由数据提供。"
            : "复权价用于均线与研究撮合，原始价用于价格限制和市值。"}
        </p>
        {raw && (
          <>
            <NumberField
              label="成交量参与率"
              value={(config.participation ?? 0.1) * 100}
              onChange={(value) => onChange({ participation: value / 100 })}
              unit="%"
            />
            <p className="research-help">费用表需覆盖回测起始日，数值由研究者明确提供。</p>
            {(config.fees ?? []).map((fee, index) => (
              <div className="research-fee" key={index}>
                <div className="research-fee-head">
                  <span>费用区间 {index + 1}</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={`删除费用区间 ${index + 1}`}
                    onClick={() => onChange({ fees: config.fees!.filter((_, i) => i !== index) })}
                  >
                    <X size={13} />
                  </Button>
                </div>
                <label className="research-field">
                  <span>生效日期</span>
                  <Input
                    type="date"
                    aria-label={`费用生效日期 ${index + 1}`}
                    value={Number.isFinite(fee.from) ? dateText(fee.from) : ""}
                    onChange={(event) => {
                      let from = NaN;
                      try {
                        from = numericDate(event.currentTarget.value);
                      } catch {
                        /* invalid draft remains editable */
                      }
                      updateFee(index, { from });
                    }}
                  />
                </label>
                {(
                  [
                    ["commissionBps", "佣金 / bps"],
                    ["minimumCommission", "最低佣金 / 元"],
                    ["transferBps", "过户费用 / bps"],
                    ["sellTaxBps", "卖出税费 / bps"],
                  ] as const
                ).map(([key, label]) => (
                  <NumberField
                    key={key}
                    label={`${label} ${index + 1}`}
                    value={fee[key] ?? config.commissionBps}
                    onChange={(value) => updateFee(index, { [key]: value })}
                    step={0.01}
                  />
                ))}
              </div>
            ))}
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                onChange({
                  fees: [
                    ...(config.fees ?? []),
                    {
                      from: Math.min(22001231, (config.fees?.at(-1)?.from ?? 20200101) + 10000),
                      minimumCommission: 0,
                      transferBps: 0,
                      sellTaxBps: 0,
                    },
                  ],
                })
              }
            >
              添加费用区间
            </Button>
          </>
        )}
        <div className="research-field">
          <span>行业黑名单</span>
          <Input
            type="search"
            aria-label="搜索行业"
            placeholder="搜索行业名称或代码"
            value={industryQuery}
            onChange={(event) => setIndustryQuery(event.currentTarget.value)}
          />
        </div>
        <div className="research-chips">
          {config.industryBlacklist.map((code) => (
            <button
              key={code}
              type="button"
              onClick={() =>
                onChange({
                  industryBlacklist: config.industryBlacklist.filter((item) => item !== code),
                })
              }
              aria-label={`移除黑名单 ${industryLabel(code)}`}
            >
              {industryLabel(code)}
              <X size={11} />
            </button>
          ))}
        </div>
        <div className="research-industry-list">
          {(manifest?.industries ?? [])
            .filter((code) =>
              industryLabel(code)
                .toLocaleLowerCase()
                .includes(industryQuery.trim().toLocaleLowerCase()),
            )
            .slice(0, 100)
            .map((code) => (
              <label key={code}>
                <input
                  type="checkbox"
                  checked={config.industryBlacklist.includes(code)}
                  onChange={(event) =>
                    onChange({
                      industryBlacklist: event.currentTarget.checked
                        ? [...config.industryBlacklist, code]
                        : config.industryBlacklist.filter((item) => item !== code),
                    })
                  }
                />
                <span>{industryLabel(code)}</span>
              </label>
            ))}
        </div>
      </details>
      {errors["advanced"] && (
        <p className="research-field-error" role="alert">
          {errors["advanced"]}
        </p>
      )}
    </fieldset>
  );
}
