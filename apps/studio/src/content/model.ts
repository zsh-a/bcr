import { Schema } from "effect";
import {
  cacheKey,
  decodeTextCitation,
  resolveTextCitation,
  textVersion,
  type TextCitation,
} from "@bcr/core";
import {
  evaluate,
  gymModel,
  validateModel,
  type FixedUseModel,
  type ModelResult,
} from "@bcr/economics-core";
import {
  AnalysisModelSchema,
  decodeAnalysisModel,
  evaluateAnalysis,
  type AnalysisModel,
  type AnalysisResult,
} from "@bcr/economics-core/analysis";
import { decodePage, type PageSpec } from "./pages/model";
import { presetContent, type ContentPreset } from "./pages/presets";
import type { VisualSpec } from "@bcr/visual-renderer";

const bounded = (max: number) => Schema.String.pipe(Schema.maxLength(max));
const id = Schema.String.pipe(
  Schema.pattern(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$/u),
  Schema.filter((s) => !["constructor", "prototype", "__proto__"].includes(s)),
);
const hash = Schema.String.pipe(Schema.pattern(/^[a-f0-9]{64}$/u));
const time = Schema.Number.pipe(Schema.int(), Schema.nonNegative());
const decimalString = Schema.String.pipe(Schema.pattern(/^(?:0|[1-9]\d{0,15})(?:\.\d{1,12})?$/u));
const parameter = Schema.Struct({
  value: decimalString,
  provenance: Schema.Literal("recorded", "external", "assumed"),
  evidenceId: Schema.NullOr(id),
});
export const ModelSchema = Schema.Struct({
  template: Schema.Literal("fixed-use"),
  version: Schema.Literal(1),
  currency: Schema.Literal("CNY"),
  parameters: Schema.Struct({
    fixed: parameter,
    variable: parameter,
    alternative: parameter,
    weeks: parameter,
  }),
  scenarios: Schema.mutable(
    Schema.Array(
      Schema.Struct({
        id,
        label: bounded(80),
        weeklyVisits: decimalString,
        attendance: decimalString,
      }),
    ).pipe(Schema.maxItems(12)),
  ),
});
export const AssetSchema = Schema.Struct({
  hash,
  name: bounded(500),
  mime: bounded(120),
  size: Schema.Number.pipe(Schema.int(), Schema.between(0, 16 * 1024 * 1024)),
});
export type ContentAsset = typeof AssetSchema.Type;
export const EvidenceSchema = Schema.Struct({
  id,
  title: bounded(300),
  url: bounded(2000),
  capturedAt: time,
  applicableDate: bounded(40),
  region: bounded(100),
  store: bounded(200),
  specification: bounded(300),
  author: bounded(200),
  license: bounded(300),
  text: bounded(500_000),
  asset: Schema.NullOr(AssetSchema),
});
export type Evidence = typeof EvidenceSchema.Type;
export const VisualSchema = Schema.Struct({
  version: Schema.Literal(1),
  template: Schema.Literal("comparison", "break-even"),
  layout: Schema.Literal("landscape", "portrait"),
  theme: Schema.Literal("paper", "night"),
  title: bounded(160),
  source: bounded(1000),
});
export const ClaimSchema = Schema.Struct({
  id,
  anchor: Schema.Unknown,
  output: bounded(100),
  reviewedRun: hash,
  reviewedValue: Schema.NullOr(bounded(100)),
  reviewedAt: time,
});
const ObservationSchema = Schema.Struct({
  id,
  observedAt: time,
  windowDays: Schema.Number.pipe(Schema.int(), Schema.between(1, 3660)),
  metric: bounded(100),
  value: Schema.NullOr(decimalString),
  unit: bounded(80),
  definition: bounded(1000),
});
export const PublicationSchema = Schema.Struct({
  id,
  releaseId: id,
  platform: bounded(100),
  url: bounded(2000),
  title: bounded(300),
  publishedAt: time,
  hours: Schema.NullOr(decimalString),
  aiCost: Schema.NullOr(decimalString),
  materialCost: Schema.NullOr(decimalString),
  platformRevenue: Schema.NullOr(decimalString),
  adRevenue: Schema.NullOr(decimalString),
  observations: Schema.Array(ObservationSchema).pipe(Schema.maxItems(200)),
});
export type Publication = typeof PublicationSchema.Type;
export type Claim = Omit<typeof ClaimSchema.Type, "anchor"> & { anchor: TextCitation };
const ProjectSchema = Schema.Struct({
  version: Schema.Literal(1),
  id,
  revision: id,
  createdAt: time,
  updatedAt: time,
  title: bounded(200),
  question: bounded(2000),
  audience: bounded(500),
  hypothesis: bounded(2000),
  status: Schema.Literal("research", "writing", "ready", "published"),
  noteId: Schema.NullOr(id),
  model: Schema.NullOr(ModelSchema),
  models: Schema.optional(Schema.Array(AnalysisModelSchema).pipe(Schema.maxItems(16))),
  pages: Schema.optional(Schema.Array(Schema.Unknown).pipe(Schema.maxItems(20))),
  evidence: Schema.Array(EvidenceSchema).pipe(Schema.maxItems(100)),
  visuals: Schema.Array(VisualSchema).pipe(Schema.maxItems(8)),
  claims: Schema.Array(ClaimSchema).pipe(Schema.maxItems(200)),
  releases: Schema.Array(id).pipe(Schema.maxItems(100)),
  publications: Schema.Array(PublicationSchema).pipe(Schema.maxItems(100)),
});
export type ContentProject = Omit<typeof ProjectSchema.Type, "claims" | "pages"> & {
  readonly claims: readonly Claim[];
  readonly pages?: readonly PageSpec[];
};
export interface ModelRun {
  readonly id: string;
  readonly model: FixedUseModel;
  readonly result: ModelResult;
  readonly evidence: readonly { id: string; hash: string }[];
}

export function safeUrl(value: string): string {
  if (!value) return "";
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password)
    throw new Error("来源和发布链接必须是 HTTP(S) 地址");
  return url.href;
}
function unique(values: readonly { id: string }[], label: string) {
  if (new Set(values.map((v) => v.id)).size !== values.length) throw new Error(`${label}身份重复`);
}
export function decodeProject(value: unknown): ContentProject {
  const p = Schema.decodeUnknownSync(ProjectSchema)(value);
  if (!p.title.trim()) throw new Error("请填写选题名称");
  if (p.model) validateModel(p.model);
  else if (p.visuals.length) throw new Error("旧版图表需要固定成本模型");
  const models = p.models?.map(decodeAnalysisModel);
  if (models) unique(models, "模型");
  const pages = p.pages?.map((page) => decodePage(page, models ?? []));
  if (pages) unique(pages, "页面");
  for (const model of models ?? []) {
    for (const parameter of model.parameters)
      if (parameter.evidenceId && !p.evidence.some((e) => e.id === parameter.evidenceId))
        throw new Error("模型引用的证据缺失");
    evaluateAnalysis(model);
  }
  unique(p.evidence, "证据");
  unique(p.claims, "判断");
  unique(p.publications, "发布记录");
  if (new Set(p.releases).size !== p.releases.length) throw new Error("发布快照身份重复");
  for (const e of p.evidence) {
    safeUrl(e.url);
    if (!e.title.trim()) throw new Error("资料标题不能为空");
  }
  for (const parameter of Object.values(p.model?.parameters ?? {}))
    if (parameter.evidenceId && !p.evidence.some((e) => e.id === parameter.evidenceId))
      throw new Error("模型引用的证据缺失");
  for (const publication of p.publications) {
    safeUrl(publication.url);
    if (!p.releases.includes(publication.releaseId)) throw new Error("发布记录引用的快照缺失");
    unique(publication.observations, "指标");
  }
  const claims = p.claims.map((c) => {
    const anchor = decodeTextCitation(c.anchor);
    if (!anchor || anchor.source.scope !== p.noteId) throw new Error("文稿绑定锚点无效");
    return { ...c, anchor };
  });
  return {
    ...p,
    claims,
    ...(models ? { models } : {}),
    ...(pages ? { pages } : {}),
  } as ContentProject;
}
export function runModel(project: ContentProject): ModelRun {
  if (!project.model) throw new Error("项目没有旧版固定成本模型");
  const ids = new Set(
    Object.values(project.model?.parameters ?? {}).flatMap((p) =>
      p.evidenceId ? [p.evidenceId] : [],
    ),
  );
  const evidence = project.evidence
    .filter((e) => ids.has(e.id))
    .map((e) => ({ id: e.id, hash: textVersion(JSON.stringify(e)) }))
    .sort((a, b) => a.id.localeCompare(b.id));
  const result = evaluate(project.model);
  return {
    id: cacheKey({
      operation: "economics.evaluate",
      inputs: evidence,
      config: { model: project.model },
      runtimeVersion: result.engine,
    }),
    model: structuredClone(project.model),
    result,
    evidence,
  };
}
export function outputValues(
  run: ModelRun,
): Record<string, { label: string; value: string | null }> {
  return Object.fromEntries([
    ["firstCheaper", { label: "首次更便宜的次数", value: run.result.breakEven.firstCheaper }],
    ["equalAt", { label: "连续持平点", value: run.result.breakEven.equalAt }],
    ...run.result.scenarios.flatMap((s) => [
      [`${s.id}.average`, { label: `${s.label} · 平均单次成本`, value: s.average }],
      [`${s.id}.savings`, { label: `${s.label} · 节省金额`, value: s.savings }],
    ]),
  ]);
}
export function claimStatus(
  claim: Claim,
  body: string,
  run: ModelRun | ReturnType<typeof projectOutputs>,
): "current" | "review" | "relink" {
  const resolved = resolveTextCitation(claim.anchor, [
    { text: body, source: { ...claim.anchor.source, version: textVersion(body), offset: 0 } },
  ]);
  if (resolved.status !== "exact" && resolved.status !== "relocated") return "relink";
  return claim.reviewedRun === run.id &&
    Object.hasOwn("values" in run ? run.values : outputValues(run), claim.output)
    ? "current"
    : "review";
}
export function evidenceSource(project: ContentProject): string {
  const used = new Set(
    Object.values(project.model?.parameters ?? {}).flatMap((p) =>
      p.evidenceId ? [p.evidenceId] : [],
    ),
  );
  const sources = project.evidence
    .filter((e) => used.has(e.id))
    .map(
      (e) =>
        `${e.title}（${e.applicableDate || new Date(e.capturedAt).toISOString().slice(0, 10)}${e.region ? `，${e.region}` : ""}）`,
    );
  return sources.length
    ? `来源：${sources.join("；")}。自设参数见模型说明。`
    : "来源：自设示例参数，不代表真实报价；计算周期按所设周数。";
}
export function newProject(
  title = "健身房年卡，去多少次才划算？",
): ContentProject & { model: FixedUseModel } {
  const now = Date.now();
  const visual = (template: VisualSpec["template"]): VisualSpec => ({
    version: 1,
    template,
    layout: "landscape",
    theme: "paper",
    title: template === "comparison" ? "不同出勤频率，花费差多少？" : "去多少次，年卡开始划算？",
    source: "",
  });
  return decodeProject({
    version: 1,
    id: crypto.randomUUID(),
    revision: crypto.randomUUID(),
    createdAt: now,
    updatedAt: now,
    title,
    question: "在什么出勤频率下，年卡比次卡划算？",
    audience: "准备购买健身卡的人",
    hypothesis: "实际出勤次数决定年卡是否划算",
    status: "research",
    noteId: null,
    model: gymModel(),
    evidence: [],
    visuals: [visual("comparison"), visual("break-even")],
    claims: [],
    releases: [],
    publications: [],
  }) as ContentProject & { model: FixedUseModel };
}

export interface AnalysisRun {
  readonly id: string;
  readonly model: AnalysisModel;
  readonly result: AnalysisResult;
  readonly evidence: readonly { id: string; hash: string }[];
}
export function analysisRuns(project: ContentProject): AnalysisRun[] {
  return (project.models ?? []).map((model) => {
    const ids = new Set(model.parameters.flatMap((p) => (p.evidenceId ? [p.evidenceId] : [])));
    const evidence = project.evidence
      .filter((e) => ids.has(e.id))
      .map((e) => ({ id: e.id, hash: textVersion(JSON.stringify(e)) }))
      .sort((a, b) => a.id.localeCompare(b.id));
    const result = evaluateAnalysis(model);
    return {
      id: cacheKey({
        operation: "analysis.evaluate",
        inputs: evidence,
        config: { model },
        runtimeVersion: result.engine,
      }),
      model,
      result,
      evidence,
    };
  });
}
export function projectOutputs(project: ContentProject): {
  id: string;
  values: Record<string, { label: string; value: string | null }>;
} {
  const runs = analysisRuns(project),
    legacy = project.model ? runModel(project) : null;
  const values = { ...(legacy ? outputValues(legacy) : {}) };
  for (const run of runs)
    for (const row of run.result.rows)
      for (const column of run.result.columns)
        values[`${run.model.id}.${row.id}.${column.id}`] = {
          label: `${run.model.title} · ${row.label} · ${column.label} (${column.unit})`,
          value: row.values[column.id] ?? null,
        };
  return {
    id: runs.length
      ? textVersion(JSON.stringify([legacy?.id, ...runs.map((r) => r.id)]))
      : (legacy?.id ?? textVersion("no-model")),
    values,
  };
}
export function newWorkspaceProject(
  preset: ContentPreset = "blank",
  title?: string,
): ContentProject {
  const content = presetContent(preset);
  return decodeProject({
    ...newProject(),
    title: title ?? content.title,
    question: "",
    audience: "",
    hypothesis: "",
    model: null,
    visuals: [],
    models: content.models,
    pages: content.pages,
  });
}
