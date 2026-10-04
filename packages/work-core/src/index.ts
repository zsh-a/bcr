import { Schema } from "effect";

export const RUNNER_PROTOCOL = "bcr-runner-1";
export type RunnerCatalog = {
  format: typeof RUNNER_PROTOCOL;
  version: string;
  engine: string;
  root: string;
  runtimes: readonly string[];
  operations: readonly string[];
  origin: string;
  provider: "local";
  instanceId: string;
  pid: number;
};

export const Id = Schema.String.pipe(Schema.pattern(/^[a-zA-Z0-9_-]{1,100}$/u));
export const Revision = Schema.String.pipe(Schema.pattern(/^[a-f0-9]{64}$/u));
export const Path = Schema.String.pipe(
  Schema.minLength(1),
  Schema.maxLength(240),
  Schema.filter(
    (p) =>
      !p.includes("\\") &&
      !p.includes("\0") &&
      !p.includes(":") &&
      p.split("/").every((s) => s && s !== "." && s !== ".." && s.trim() === s),
  ),
);
const text = (max: number) => Schema.String.pipe(Schema.maxLength(max));
const positive = (max: number) => Schema.Number.pipe(Schema.int(), Schema.between(1, max));
export const ParameterSchema = Schema.Struct({
  key: Id,
  label: text(120),
  type: Schema.Literal("number", "string", "boolean"),
  min: Schema.optional(Schema.Number),
  max: Schema.optional(Schema.Number),
  step: Schema.optional(Schema.Number),
});
export const TargetSchema = Schema.Union(
  Schema.Struct({ id: Id, runtime: Schema.Literal("html"), entry: Path }),
  Schema.Struct({
    id: Id,
    runtime: Schema.Literal("remotion"),
    entry: Path,
    exportName: Schema.optional(Schema.String.pipe(Schema.pattern(/^[a-zA-Z_$][a-zA-Z0-9_$]*$/u))),
    width: positive(7680),
    height: positive(7680),
    fps: positive(120),
    durationInFrames: positive(216000),
    propsFile: Schema.optional(Path),
    parameters: Schema.optional(Schema.Array(ParameterSchema).pipe(Schema.maxItems(40))),
  }),
);
export const DefinitionSchema = Schema.Struct({
  format: Schema.Literal("bcr-project-1"),
  id: Id,
  title: text(200).pipe(Schema.minLength(1)),
  targets: Schema.Array(TargetSchema).pipe(Schema.minItems(1), Schema.maxItems(20)),
});
export type Definition = typeof DefinitionSchema.Type;
export type Target = typeof TargetSchema.Type;
export type Parameter = typeof ParameterSchema.Type;
export const decode = <A, I>(schema: Schema.Schema<A, I>, value: unknown): A =>
  Schema.decodeUnknownSync(schema, { onExcessProperty: "error" })(value);
export function definition(value: unknown): Definition {
  const work = decode(DefinitionSchema, value);
  if (new Set(work.targets.map((t) => t.id)).size !== work.targets.length)
    throw new Error("目标 ID 重复");
  for (const target of work.targets) {
    if (target.runtime !== "remotion") continue;
    const keys = (target.parameters ?? []).map((p) => p.key);
    if (
      new Set(keys).size !== keys.length ||
      keys.some((k) => ["__proto__", "constructor", "prototype"].includes(k))
    )
      throw new Error("参数身份无效");
    if (keys.length && !target.propsFile) throw new Error("参数面板需要 propsFile");
    for (const p of target.parameters ?? []) {
      if (
        (p.min !== undefined && !Number.isFinite(p.min)) ||
        (p.max !== undefined && !Number.isFinite(p.max)) ||
        (p.min !== undefined && p.max !== undefined && p.min > p.max) ||
        (p.step !== undefined && (!Number.isFinite(p.step) || p.step <= 0))
      )
        throw new Error(`参数范围无效：${p.key}`);
    }
  }
  return work;
}
export type WorkRef = { provider: string; id: string };
export type WorkSummary = {
  ref: WorkRef;
  title: string;
  revision: string;
  targets: readonly Target[];
  capabilities: readonly string[];
};
export type SourceFile = { path: string; hash: string; size: number };
export type Project = WorkSummary & {
  directory: string;
  definition: Definition;
  files: readonly SourceFile[];
};
export const RenderSchema = Schema.Struct({
  id: Id,
  revision: Revision,
  target: Id,
  requestId: Id,
  kind: Schema.Literal("validate", "preview", "capture", "video", "archive"),
  frames: Schema.optional(
    Schema.Array(Schema.Number.pipe(Schema.int(), Schema.between(0, 216000))).pipe(
      Schema.minItems(1),
      Schema.maxItems(30),
    ),
  ),
  from: Schema.optional(Schema.Number.pipe(Schema.int(), Schema.between(0, 216000))),
  to: Schema.optional(Schema.Number.pipe(Schema.int(), Schema.between(0, 216000))),
  scale: Schema.optional(Schema.Number.pipe(Schema.between(0.1, 1))),
});
export type RenderRequest = typeof RenderSchema.Type;
export type Job = {
  id: string;
  request: RenderRequest;
  renderKey: string;
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled" | "interrupted";
  progress: number;
  stage: string;
  createdAt: number;
  updatedAt: number;
  logs: string[];
  outputs: { name: string; size: number; hash: string }[];
  error?: string;
};
export const ReviewSchema = Schema.Struct({
  id: Id,
  sourceRevision: Revision,
  target: Id,
  frame: Schema.optional(Schema.Number.pipe(Schema.int(), Schema.nonNegative())),
  sceneId: Schema.optional(Id),
  comment: text(4000).pipe(Schema.minLength(1)),
  status: Schema.Literal("open", "resolved"),
});
export type Review = typeof ReviewSchema.Type;
export const ReviewsSchema = Schema.Struct({
  revision: Revision,
  items: Schema.Array(ReviewSchema).pipe(Schema.maxItems(1000)),
});
export type Reviews = typeof ReviewsSchema.Type;
export const ParamsSchema = Schema.Struct({
  id: Id,
  revision: Revision,
  target: Id,
  requestId: Id,
  values: Schema.Record({
    key: Schema.String,
    value: Schema.Union(Schema.Number, Schema.String, Schema.Boolean),
  }),
});
export const ReviewWriteSchema = Schema.Struct({
  id: Id,
  revision: Revision,
  requestId: Id,
  review: ReviewSchema,
});
export function capabilities(targets: readonly Target[]): string[] {
  return [
    "read",
    "snapshot",
    "preview",
    "reviews",
    "archive",
    ...(targets.some((t) => t.runtime === "remotion")
      ? ["parameters", "capture", "video", "seek"]
      : []),
  ];
}
export function parameterValues(
  target: Target,
  current: Record<string, unknown>,
  values: Record<string, string | number | boolean>,
) {
  if (target.runtime !== "remotion" || !target.propsFile) throw new Error("目标不支持参数修改");
  const next = { ...current };
  for (const [key, value] of Object.entries(values)) {
    const spec = target.parameters?.find((p) => p.key === key);
    if (
      !spec ||
      typeof value !== spec.type ||
      (typeof value === "number" &&
        (!Number.isFinite(value) ||
          (spec.min !== undefined && value < spec.min) ||
          (spec.max !== undefined && value > spec.max))) ||
      (typeof value === "string" && value.length > 4000)
    )
      throw new Error(`参数无效：${key}`);
    Object.defineProperty(next, key, {
      value,
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  return next;
}
