import {
  decodeAnalysisModel,
  type AnalysisModel,
  type Expression,
} from "@bcr/economics-core/analysis";
import type { PageSpec } from "./model";

export const presetLabels = {
  blank: "空白专题",
  gym: "使用次数与固定成本",
  cooking: "做饭与外卖",
  commute: "住房与通勤",
} as const;
export type ContentPreset = keyof typeof presetLabels;
const ref = (ref: string): Expression => ({ ref });
const op = (op: Extract<Expression, { op: string }>["op"], ...args: Expression[]): Expression => ({
  op,
  args,
});
const parameter = (id: string, label: string, value: string, unit: string) => ({
  id,
  label,
  value,
  unit,
  provenance: "assumed" as const,
  evidenceId: null,
});
const formula = (id: string, label: string, unit: string, expression: Expression) => ({
  id,
  label,
  unit,
  expression,
});
export function presetContent(preset: ContentPreset): {
  title: string;
  models: AnalysisModel[];
  pages: PageSpec[];
} {
  let model: AnalysisModel | undefined;
  if (preset === "gym")
    model = decodeAnalysisModel({
      version: 1,
      id: "cost",
      title: "固定成本与使用次数",
      parameters: [
        parameter("fixed", "固定支出", "2400", "CNY"),
        parameter("perUse", "按次价格", "60", "CNY/visit"),
        parameter("visits", "使用次数", "48", "visit"),
      ],
      formulas: [
        formula("total", "固定方案", "CNY", ref("fixed")),
        formula("alternative", "按次方案", "CNY", op("multiply", ref("perUse"), ref("visits"))),
        formula("average", "平均每次", "CNY/visit", op("divide", ref("fixed"), ref("visits"))),
        formula("threshold", "持平次数", "visit", op("divide", ref("fixed"), ref("perUse"))),
      ],
      scenarios: [
        { id: "low", label: "24 次", values: { visits: "24" } },
        { id: "high", label: "96 次", values: { visits: "96" } },
      ],
      sweep: { parameter: "visits", from: "1", to: "120", points: 120 },
    });
  if (preset === "cooking")
    model = decodeAnalysisModel({
      version: 1,
      id: "cost",
      title: "损耗与每餐成本",
      parameters: [
        parameter("ingredients", "食材支出", "12", "CNY/meal"),
        parameter("loss", "损耗率", "0.15", "1"),
        parameter("takeout", "外卖价格", "25", "CNY/meal"),
        parameter("minutes", "做饭用时", "35", "min/meal"),
      ],
      formulas: [
        formula(
          "home",
          "做饭现金",
          "CNY/meal",
          op("divide", ref("ingredients"), op("subtract", { value: "1", unit: "1" }, ref("loss"))),
        ),
        formula("delivery", "外卖现金", "CNY/meal", ref("takeout")),
        formula("time", "做饭时间", "min/meal", ref("minutes")),
      ],
      scenarios: [
        { id: "low", label: "低损耗", values: { loss: "0.05" } },
        { id: "high", label: "高损耗", values: { loss: "0.4" } },
      ],
      sweep: { parameter: "loss", from: "0", to: "0.6", points: 31 },
    });
  if (preset === "commute")
    model = decodeAnalysisModel({
      version: 1,
      id: "cost",
      title: "住房与通勤的现金和时间",
      parameters: [
        parameter("rent", "月租", "3000", "CNY/month"),
        parameter("fare", "每日交通", "12", "CNY/day"),
        parameter("days", "每月通勤天数", "22", "day/month"),
        parameter("minutes", "每天通勤分钟", "80", "min/day"),
      ],
      formulas: [
        formula(
          "cash",
          "每月现金支出",
          "CNY/month",
          op("add", ref("rent"), op("multiply", ref("fare"), ref("days"))),
        ),
        formula("time", "每月通勤时间", "min/month", op("multiply", ref("minutes"), ref("days"))),
      ],
      scenarios: [
        { id: "near", label: "近处居住", values: { rent: "4200", fare: "0", minutes: "20" } },
      ],
    });
  const title = presetLabels[preset];
  const elements: PageSpec["elements"] = {
    root: { type: "Stack", props: { gap: "wide" }, children: ["heading", "intro"] },
    heading: { type: "Heading", props: { text: title, level: 1 } },
    intro: {
      type: "Text",
      props: {
        text:
          preset === "blank"
            ? "写下你的问题，添加资料，组织你的发现。"
            : "以下是自设示例参数。调整条件，观察结果，再使用真实资料核验。",
      },
    },
  };
  const order = ["heading", "intro"];
  if (model) {
    elements.parameters = {
      type: "Columns",
      props: { columns: 3 },
      children: model.parameters.map((p) => `parameter-${p.id}`),
    };
    for (const p of model.parameters)
      elements[`parameter-${p.id}`] = {
        type: "Parameter",
        props: { model: model.id, parameter: p.id },
      };
    order.push("parameters");
    const groups = new Map<string, string[]>();
    for (const f of model.formulas) groups.set(f.unit, [...(groups.get(f.unit) ?? []), f.id]);
    let i = 0;
    for (const [unit, outputs] of groups) {
      const id = `chart-${++i}`;
      elements[id] = {
        type: "Chart",
        props: { model: model.id, outputs, kind: "bar", title: `情景比较 · ${unit}` },
      };
      order.push(id);
    }
    if (model.sweep) {
      elements.sensitivity = {
        type: "Chart",
        props: {
          model: model.id,
          outputs: [...groups.values()][0]!,
          kind: "line",
          title: "参数变化如何影响结果",
        },
      };
      order.push("sensitivity");
    }
    elements.table = {
      type: "Table",
      props: { model: model.id, outputs: model.formulas.map((f) => f.id) },
    };
    order.push("table");
  }
  elements.sources = { type: "Sources", props: { title: "资料与适用范围" } };
  order.push("sources");
  elements.root = { type: "Stack", props: { gap: "wide" }, children: order };
  return {
    title,
    models: model ? [model] : [],
    pages: [
      {
        version: 1,
        catalog: "bcr-page-1",
        id: "main",
        title,
        layout: "landscape",
        theme: "paper",
        root: "root",
        elements,
      },
    ],
  };
}
