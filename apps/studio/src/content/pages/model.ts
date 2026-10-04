import { z } from "zod";
import type { AnalysisModel } from "@bcr/economics-core/analysis";

const id = z
  .string()
  .regex(/^[a-zA-Z][a-zA-Z0-9_-]{0,79}$/u)
  .refine((s) => !["__proto__", "constructor", "prototype"].includes(s));
const text = z.string().max(10000);
export const componentProps = {
  Stack: z.strictObject({ gap: z.enum(["compact", "normal", "wide"]) }),
  Columns: z.strictObject({ columns: z.union([z.literal(2), z.literal(3)]) }),
  Heading: z.strictObject({ text, level: z.union([z.literal(1), z.literal(2), z.literal(3)]) }),
  Text: z.strictObject({
    text,
    model: id.optional(),
    reviewedRun: z
      .string()
      .regex(/^[a-f0-9]{64}$/u)
      .optional(),
  }),
  Metric: z.strictObject({ model: id, output: id, label: text, scenario: id.optional() }),
  Parameter: z.strictObject({ model: id, parameter: id }),
  Chart: z.strictObject({
    model: id,
    outputs: z.array(id).min(1).max(6),
    kind: z.enum(["bar", "line"]),
    title: text,
  }),
  Table: z.strictObject({ model: id, outputs: z.array(id).min(1).max(12) }),
  Sources: z.strictObject({ title: text }),
};
const children = z.array(id).max(100).optional();
export const BlockSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("Stack"), props: componentProps.Stack, children }),
  z.strictObject({ type: z.literal("Columns"), props: componentProps.Columns, children }),
  z.strictObject({ type: z.literal("Heading"), props: componentProps.Heading }),
  z.strictObject({ type: z.literal("Text"), props: componentProps.Text }),
  z.strictObject({ type: z.literal("Metric"), props: componentProps.Metric }),
  z.strictObject({ type: z.literal("Parameter"), props: componentProps.Parameter }),
  z.strictObject({ type: z.literal("Chart"), props: componentProps.Chart }),
  z.strictObject({ type: z.literal("Table"), props: componentProps.Table }),
  z.strictObject({ type: z.literal("Sources"), props: componentProps.Sources }),
]);
export const PageSchema = z.strictObject({
  version: z.literal(1),
  catalog: z.literal("bcr-page-1"),
  id,
  title: z.string().min(1).max(200),
  layout: z.enum(["landscape", "portrait"]),
  theme: z.enum(["paper", "night"]),
  root: id,
  elements: z.record(id, BlockSchema),
});
export type PageSpec = z.infer<typeof PageSchema>;
export type PageBlock = z.infer<typeof BlockSchema>;
export const PagePatchSchema = z.strictObject({
  id,
  title: z.string().min(1).max(200).optional(),
  layout: PageSchema.shape.layout.optional(),
  theme: PageSchema.shape.theme.optional(),
  root: id.optional(),
  upsert: z.record(id, BlockSchema).optional(),
  remove: z.array(id).max(100).optional(),
});
export type PagePatch = z.infer<typeof PagePatchSchema>;

export function decodePage(value: unknown, models: readonly AnalysisModel[]): PageSpec {
  const page = PageSchema.parse(value),
    visited = new Set<string>();
  if (Object.keys(page.elements).length > 100) throw new Error("页面最多包含 100 个区块");
  const walk = (key: string, depth: number) => {
    if (depth > 12 || visited.has(key)) throw new Error("页面区块循环、重复引用或嵌套过深");
    const block = page.elements[key];
    if (!block) throw new Error(`页面区块缺失：${key}`);
    visited.add(key);
    const props = block.props;
    if ("model" in props && props.model) {
      const model = models.find((m) => m.id === props.model);
      if (!model) throw new Error(`页面引用的模型缺失：${props.model}`);
      const outputs = new Set([...model.parameters, ...model.formulas].map((f) => f.id));
      if ("parameter" in props && !model.parameters.some((p) => p.id === props.parameter))
        throw new Error("页面参数不存在");
      if ("output" in props && !outputs.has(props.output)) throw new Error("页面输出不存在");
      if ("outputs" in props && props.outputs.some((o) => !outputs.has(o)))
        throw new Error("页面输出不存在");
      if (
        "scenario" in props &&
        props.scenario &&
        props.scenario !== "base" &&
        !model.scenarios.some((s) => s.id === props.scenario)
      )
        throw new Error("页面情景不存在");
      if (block.type === "Chart") {
        const units = block.props.outputs.map(
          (id) => [...model.parameters, ...model.formulas].find((f) => f.id === id)!.unit,
        );
        if (new Set(units).size > 1) throw new Error("不同单位请分图展示");
        if (block.props.kind === "line" && !model.sweep)
          throw new Error("曲线图需要模型的敏感性范围");
      }
    }
    if ("children" in block) block.children?.forEach((child) => walk(child, depth + 1));
  };
  walk(page.root, 0);
  if (visited.size !== Object.keys(page.elements).length) throw new Error("页面包含未连接的区块");
  return page;
}
export function patchPage(
  page: PageSpec,
  input: PagePatch,
  models: readonly AnalysisModel[],
): PageSpec {
  const { id, upsert, remove, ...metadata } = PagePatchSchema.parse(input);
  if (id !== page.id) throw new Error("页面身份不匹配");
  const elements = { ...page.elements, ...upsert };
  for (const key of remove ?? []) delete elements[key];
  return decodePage({ ...page, ...metadata, elements }, models);
}
