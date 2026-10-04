import Decimal from "decimal.js";
import { Schema } from "effect";

export const ANALYSIS_ENGINE = "decimal-analysis-1";
const D = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });
export const Identifier = Schema.String.pipe(
  Schema.pattern(/^[a-zA-Z][a-zA-Z0-9_-]{0,79}$/u),
  Schema.filter((v) => !["constructor", "prototype", "__proto__"].includes(v)),
);
export const DecimalString = Schema.String.pipe(
  Schema.pattern(/^-?(?:0|[1-9]\d{0,15})(?:\.\d{1,12})?$/u),
);
const label = Schema.String.pipe(Schema.minLength(1), Schema.maxLength(200));
// Units use products and divisions of named base units, e.g. CNY/meal, min/day.
export const Unit = Schema.String.pipe(
  Schema.maxLength(100),
  Schema.pattern(/^(?:1|[A-Za-z][A-Za-z0-9]*(?:[*/][A-Za-z][A-Za-z0-9]*)*)$/u),
);
export type Expression =
  | { readonly ref: string }
  | { readonly value: string; readonly unit: string }
  | {
      readonly op: "add" | "subtract" | "multiply" | "divide" | "min" | "max" | "ceil" | "floor";
      readonly args: readonly Expression[];
    };
export const ExpressionSchema: Schema.Schema<Expression> = Schema.suspend(() =>
  Schema.Union(
    Schema.Struct({ ref: Identifier }),
    Schema.Struct({ value: DecimalString, unit: Unit }),
    Schema.Struct({
      op: Schema.Literal("add", "subtract", "multiply", "divide", "min", "max", "ceil", "floor"),
      args: Schema.Array(ExpressionSchema).pipe(Schema.minItems(1), Schema.maxItems(8)),
    }),
  ),
).annotations({ identifier: "AnalysisExpression" });
export const AnalysisModelSchema = Schema.Struct({
  version: Schema.Literal(1),
  id: Identifier,
  title: label,
  parameters: Schema.Array(
    Schema.Struct({
      id: Identifier,
      label,
      value: DecimalString,
      unit: Unit,
      provenance: Schema.Literal("recorded", "external", "assumed"),
      evidenceId: Schema.NullOr(Schema.String.pipe(Schema.maxLength(100))),
    }),
  ).pipe(Schema.maxItems(64)),
  formulas: Schema.Array(
    Schema.Struct({ id: Identifier, label, unit: Unit, expression: ExpressionSchema }),
  ).pipe(Schema.minItems(1), Schema.maxItems(64)),
  scenarios: Schema.Array(
    Schema.Struct({
      id: Identifier,
      label,
      values: Schema.Record({ key: Identifier, value: DecimalString }),
    }),
  ).pipe(Schema.maxItems(24)),
  sweep: Schema.optional(
    Schema.Struct({
      parameter: Identifier,
      from: DecimalString,
      to: DecimalString,
      points: Schema.Number.pipe(Schema.int(), Schema.between(2, 120)),
    }),
  ),
});
export type AnalysisModel = typeof AnalysisModelSchema.Type;
type Dimensions = Map<string, number>;
function dimensions(unit: string): Dimensions {
  const result = new Map<string, number>();
  if (unit === "1") return result;
  const parts = unit.split(/([*/])/u);
  for (let i = 0; i < parts.length; i += 2) {
    const key = parts[i]!;
    const n = (result.get(key) ?? 0) + (parts[i - 1] === "/" ? -1 : 1);
    if (n) result.set(key, n);
    else result.delete(key);
  }
  return result;
}
function same(a: Dimensions, b: Dimensions) {
  return a.size === b.size && [...a].every(([k, n]) => b.get(k) === n);
}
function combine(a: Dimensions, b: Dimensions, sign: number): Dimensions {
  const out = new Map(a);
  for (const [k, n] of b) {
    const v = (out.get(k) ?? 0) + n * sign;
    if (v) out.set(k, v);
    else out.delete(k);
  }
  return out;
}
type Quantity = { value: Decimal; dimension: Dimensions };
export interface AnalysisRow {
  readonly id: string;
  readonly label: string;
  readonly values: Readonly<Record<string, string>>;
}
export interface AnalysisResult {
  readonly engine: typeof ANALYSIS_ENGINE;
  readonly columns: readonly { id: string; label: string; unit: string }[];
  readonly rows: readonly AnalysisRow[];
  readonly sweep: readonly AnalysisRow[];
}

export function decodeAnalysisModel(input: unknown): AnalysisModel {
  const model = Schema.decodeUnknownSync(AnalysisModelSchema, { onExcessProperty: "error" })(input);
  const ids = [...model.parameters, ...model.formulas].map((v) => v.id);
  if (new Set(ids).size !== ids.length) throw new Error("参数与公式 ID 必须唯一");
  if (
    model.scenarios.some((s) => s.id === "base") ||
    new Set(model.scenarios.map((s) => s.id)).size !== model.scenarios.length
  )
    throw new Error("情景 ID 重复");
  let nodes = 0;
  const visit = (e: Expression, depth: number) => {
    if (++nodes > 2048 || depth > 24) throw new Error("公式结构超过限制");
    if ("ref" in e && !ids.includes(e.ref)) throw new Error(`未知公式引用：${e.ref}`);
    if ("op" in e) {
      const unary = e.op === "ceil" || e.op === "floor";
      if (
        (unary && e.args.length !== 1) ||
        (!unary && e.args.length < 2) ||
        ((e.op === "divide" || e.op === "subtract") && e.args.length !== 2)
      )
        throw new Error("公式操作的参数数量无效");
      e.args.forEach((a) => visit(a, depth + 1));
    }
  };
  model.formulas.forEach((f) => visit(f.expression, 0));
  for (const scenario of model.scenarios)
    for (const key of Object.keys(scenario.values))
      if (!model.parameters.some((p) => p.id === key)) throw new Error(`情景引用未知参数：${key}`);
  if (
    model.sweep &&
    (!model.parameters.some((p) => p.id === model.sweep!.parameter) ||
      new D(model.sweep.from).gte(model.sweep.to))
  )
    throw new Error("敏感性范围无效");
  return model;
}

/** No eval, floating-point money arithmetic, network, clock or UI dependencies. */
export function evaluateAnalysis(
  input: AnalysisModel,
  overrides: Readonly<Record<string, string>> = {},
): AnalysisResult {
  const model = decodeAnalysisModel(input);
  for (const [key, value] of Object.entries(overrides)) {
    if (!model.parameters.some((p) => p.id === key)) throw new Error(`未知参数：${key}`);
    Schema.decodeUnknownSync(DecimalString)(value);
  }
  const calculate = (
    id: string,
    label: string,
    values: Readonly<Record<string, string>>,
  ): AnalysisRow => {
    const quantities = new Map<string, Quantity>(
      model.parameters.map((p) => [
        p.id,
        { value: new D(values[p.id] ?? p.value), dimension: dimensions(p.unit) },
      ]),
    );
    const visiting = new Set<string>();
    const resolve = (key: string): Quantity => {
      if (quantities.has(key)) return quantities.get(key)!;
      if (visiting.has(key)) throw new Error(`公式存在循环：${key}`);
      const formula = model.formulas.find((f) => f.id === key);
      if (!formula) throw new Error(`未知引用：${key}`);
      visiting.add(key);
      const q = expression(formula.expression);
      if (!same(q.dimension, dimensions(formula.unit)))
        throw new Error(`公式单位不一致：${formula.label}`);
      if (!q.value.isFinite() || q.value.abs().gt("1e30"))
        throw new Error(`计算结果超限：${formula.label}`);
      quantities.set(key, q);
      visiting.delete(key);
      return q;
    };
    const expression = (e: Expression): Quantity => {
      if ("ref" in e) return resolve(e.ref);
      if ("value" in e) return { value: new D(e.value), dimension: dimensions(e.unit) };
      const args = e.args.map(expression),
        first = args[0]!;
      if (e.op === "ceil" || e.op === "floor")
        return { ...first, value: e.op === "ceil" ? first.value.ceil() : first.value.floor() };
      return args.slice(1).reduce((a, b) => {
        if (e.op === "multiply")
          return { value: a.value.mul(b.value), dimension: combine(a.dimension, b.dimension, 1) };
        if (e.op === "divide") {
          if (b.value.isZero()) throw new Error("公式除数不能为零");
          return { value: a.value.div(b.value), dimension: combine(a.dimension, b.dimension, -1) };
        }
        if (!same(a.dimension, b.dimension)) throw new Error("不同单位不能相加、相减或比较");
        const value =
          e.op === "add"
            ? a.value.add(b.value)
            : e.op === "subtract"
              ? a.value.sub(b.value)
              : e.op === "min"
                ? D.min(a.value, b.value)
                : D.max(a.value, b.value);
        return { value, dimension: a.dimension };
      }, first);
    };
    const result = Object.fromEntries(
      [...model.parameters, ...model.formulas].map((v) => [v.id, resolve(v.id).value.toFixed()]),
    );
    return { id, label, values: result };
  };
  const rows = [
    calculate("base", "当前参数", overrides),
    ...model.scenarios.map((s) => calculate(s.id, s.label, { ...overrides, ...s.values })),
  ];
  const sweep = model.sweep
    ? Array.from({ length: model.sweep.points }, (_, i) => {
        const s = model.sweep!,
          value = new D(s.from)
            .add(
              new D(s.to)
                .sub(s.from)
                .mul(i)
                .div(s.points - 1),
            )
            .toDecimalPlaces(12)
            .toFixed();
        return calculate(`point-${i}`, value, { ...overrides, [s.parameter]: value });
      })
    : [];
  return {
    engine: ANALYSIS_ENGINE,
    columns: [...model.parameters, ...model.formulas].map(({ id, label, unit }) => ({
      id,
      label,
      unit,
    })),
    rows,
    sweep,
  };
}
