import Decimal from "decimal.js";

/** Never mutate Decimal's global configuration: other workspaces may use it too. */
const D = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });
export const ENGINE_VERSION = "economics-1";
export const PARAMETER_KEYS = ["fixed", "variable", "alternative", "weeks"] as const;
export type ParameterKey = (typeof PARAMETER_KEYS)[number];
export type Provenance = "recorded" | "external" | "assumed";
export interface Parameter {
  value: string;
  provenance: Provenance;
  evidenceId: string | null;
}
export interface Scenario {
  id: string;
  label: string;
  weeklyVisits: string;
  attendance: string;
}
export interface FixedUseModel {
  template: "fixed-use";
  version: 1;
  currency: "CNY";
  parameters: Record<ParameterKey, Parameter>;
  scenarios: Scenario[];
}
export interface Comparison {
  visits: string;
  total: string;
  alternative: string;
  average: string | null;
  savings: string;
}
export interface ModelResult {
  engine: typeof ENGINE_VERSION;
  formula: typeof FORMULAS;
  breakEven: {
    equalAt: string | null;
    firstNoMore: string | null;
    firstCheaper: string | null;
    reason: string | null;
  };
  scenarios: (Comparison & { id: string; label: string })[];
  curve: Comparison[];
  sensitivity: { attendance: string; scenarios: (Comparison & { id: string })[] }[];
}
export const FORMULAS = {
  total: "fixed + variable * visits",
  alternative: "alternative * visits",
  visits: "weeks * weeklyVisits * attendance",
  average: "total / visits",
  breakEven: "fixed / (alternative - variable)",
} as const;
export const PARAMETER_INFO: Record<ParameterKey, { label: string; unit: string }> = {
  fixed: { label: "年卡固定费用", unit: "元 / 周期" },
  variable: { label: "年卡每次额外费用", unit: "元 / 次" },
  alternative: { label: "次卡价格", unit: "元 / 次" },
  weeks: { label: "计算周期", unit: "周" },
};

export function decimal(value: string, label = "数值", max = "1000000000000"): Decimal {
  if (!/^(?:0|[1-9]\d{0,15})(?:\.\d{1,12})?$/u.test(value))
    throw new Error(`${label}须为非负十进制数，最多 12 位小数`);
  const result = new D(value);
  if (result.gt(max)) throw new Error(`${label}超过允许范围`);
  return result;
}

export function validateModel(model: FixedUseModel): FixedUseModel {
  if (model.template !== "fixed-use" || model.version !== 1 || model.currency !== "CNY")
    throw new Error("不支持的经济模型版本或币种");
  for (const key of PARAMETER_KEYS) {
    const p = model.parameters[key];
    decimal(p.value, PARAMETER_INFO[key].label, key === "weeks" ? "5200" : undefined);
    if (!["recorded", "external", "assumed"].includes(p.provenance))
      throw new Error("参数来源分类无效");
  }
  if (decimal(model.parameters.weeks.value).isZero()) throw new Error("计算周期必须大于零");
  if (!model.scenarios.length || model.scenarios.length > 12) throw new Error("请保留 1–12 个情景");
  const ids = new Set<string>();
  for (const scenario of model.scenarios) {
    if (
      !scenario.id ||
      ids.has(scenario.id) ||
      !scenario.label.trim() ||
      scenario.label.length > 80
    )
      throw new Error("情景名称或身份无效");
    ids.add(scenario.id);
    decimal(scenario.weeklyVisits, "每周次数", "100");
    decimal(scenario.attendance, "出勤率", "1");
  }
  return model;
}

function comparison(model: FixedUseModel, n: Decimal): Comparison {
  const p = model.parameters;
  const total = new D(p.fixed.value).plus(new D(p.variable.value).times(n));
  const alternative = new D(p.alternative.value).times(n);
  return {
    visits: n.toString(),
    total: total.toString(),
    alternative: alternative.toString(),
    average: n.isZero() ? null : total.div(n).toString(),
    savings: alternative.minus(total).toString(),
  };
}

export function evaluate(model: FixedUseModel): ModelResult {
  validateModel(model);
  const p = model.parameters;
  const fixed = new D(p.fixed.value),
    difference = new D(p.alternative.value).minus(p.variable.value);
  let breakEven: ModelResult["breakEven"];
  if (difference.gt(0)) {
    const point = fixed.div(difference);
    // Zero visits is useful on the cost curve, but is not a use of either product.
    breakEven = {
      equalAt: point.toString(),
      firstNoMore: D.max(1, point.ceil()).toString(),
      firstCheaper: point.floor().plus(1).toString(),
      reason: null,
    };
  } else {
    breakEven = {
      equalAt: difference.isZero() && fixed.isZero() ? "0" : null,
      firstNoMore: difference.isZero() && fixed.isZero() ? "1" : null,
      firstCheaper: null,
      reason:
        difference.isZero() && fixed.isZero()
          ? "两种方案始终持平"
          : "年卡每次费用不低于次卡，正次数范围内不会更便宜",
    };
  }
  const scenarios = model.scenarios.map((s) => ({
    ...comparison(model, new D(p.weeks.value).times(s.weeklyVisits).times(s.attendance)),
    id: s.id,
    label: s.label,
  }));
  const max = D.min(
    10000,
    D.max(100, ...scenarios.map((s) => s.visits), breakEven.firstCheaper ?? 0).times("1.2"),
  ).ceil();
  const positions = new Set(
    Array.from({ length: 101 }, (_, i) => max.times(i).div(100).toString()),
  );
  if (breakEven.equalAt && new D(breakEven.equalAt).lte(max)) positions.add(breakEven.equalAt);
  const curve = [...positions]
    .sort((a, b) => new D(a).cmp(b))
    .map((n) => comparison(model, new D(n)));
  return {
    engine: ENGINE_VERSION,
    formula: FORMULAS,
    breakEven,
    scenarios,
    curve,
    sensitivity: ["0.25", "0.5", "0.75", "1"].map((attendance) => ({
      attendance,
      scenarios: model.scenarios.map((s) => ({
        id: s.id,
        ...comparison(model, new D(p.weeks.value).times(s.weeklyVisits).times(attendance)),
      })),
    })),
  };
}

export function formatDecimal(value: string | null, digits = 2): string {
  return value === null ? "—" : new D(value).toFixed(digits);
}

export function gymModel(): FixedUseModel {
  const parameter = (value: string): Parameter => ({
    value,
    provenance: "assumed",
    evidenceId: null,
  });
  return {
    template: "fixed-use",
    version: 1,
    currency: "CNY",
    parameters: {
      fixed: parameter("2400"),
      variable: parameter("0"),
      alternative: parameter("60"),
      weeks: parameter("52"),
    },
    scenarios: [1, 2, 3].map((n) => ({
      id: `weekly-${n}`,
      label: `每周 ${n} 次`,
      weeklyVisits: String(n),
      attendance: "1",
    })),
  };
}
