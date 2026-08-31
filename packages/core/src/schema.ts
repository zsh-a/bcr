import { Schema } from "effect";

/** 架构文档 §0：按负载类型分发的执行平面。 */
export const RuntimeKind = Schema.Literal("wasm", "webgpu", "webcodecs", "js");
export type RuntimeKind = typeof RuntimeKind.Type;

/** 架构文档 §3：Artifact 的存放位置。 */
export const ArtifactStorage = Schema.Literal("memory", "shared-memory", "opfs");
export type ArtifactStorage = typeof ArtifactStorage.Type;

/** 架构文档 §3：任务之间只传 ArtifactRef，不直接传 ArrayBuffer/Blob。 */
export const ArtifactRef = Schema.Struct({
  id: Schema.String,
  /** 如 "media/video.mp4" / "audio/pcm-f32" / "subtitle/segments"。 */
  type: Schema.String,
  storage: ArtifactStorage,
  format: Schema.optional(Schema.String),
  hash: Schema.optional(Schema.String),
});
export type ArtifactRef = typeof ArtifactRef.Type;

/** 任务输出位声明：执行前不知道 id/hash，只声明类型与存储约束。 */
export const ArtifactSpec = Schema.Struct({
  type: Schema.String,
  storage: Schema.optional(ArtifactStorage),
  format: Schema.optional(Schema.String),
});
export type ArtifactSpec = typeof ArtifactSpec.Type;

export const ResourceRequirements = Schema.Struct({
  memoryMB: Schema.optional(Schema.Number),
  threads: Schema.optional(Schema.Number),
  gpu: Schema.optional(Schema.Boolean),
});
export type ResourceRequirements = typeof ResourceRequirements.Type;

export const CachePolicy = Schema.Struct({
  enabled: Schema.Boolean,
  key: Schema.optional(Schema.String),
});
export type CachePolicy = typeof CachePolicy.Type;

/** 架构文档 §2：ComputeTask。config 参与 cacheKey 计算（§7）。 */
export const ComputeTask = Schema.Struct({
  id: Schema.String,
  runtime: RuntimeKind,
  operation: Schema.String,
  inputs: Schema.Array(ArtifactRef),
  outputs: Schema.Array(ArtifactSpec),
  resources: Schema.optional(ResourceRequirements),
  cache: Schema.optional(CachePolicy),
  config: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.Unknown })),
});
export type ComputeTask = typeof ComputeTask.Type;

export const decodeComputeTask = Schema.decodeUnknown(ComputeTask);
export const decodeArtifactRef = Schema.decodeUnknown(ArtifactRef);

/**
 * 流水线节点（§3 DAG 的正向编排）：声明依赖的节点 id，
 * 调度器在上游全部完成后把其输出依序作为本节点的 inputs 实例化成 ComputeTask。
 * 与 ComputeTask 的差异只在 inputs 由依赖推导而非显式给出。
 */
export const PipelineNode = Schema.Struct({
  id: Schema.String,
  runtime: RuntimeKind,
  operation: Schema.String,
  /** 依赖的节点 id；全部完成后其输出按依赖声明顺序拼接为 inputs。 */
  after: Schema.optional(Schema.Array(Schema.String)),
  /**
   * 外部输入 artifact（根节点消费已有数据用，如源文件）；
   * 实例化时置于依赖输出之前。下游节点按 type 选取所需输入。
   */
  inputs: Schema.optional(Schema.Array(ArtifactRef)),
  outputs: Schema.Array(ArtifactSpec),
  resources: Schema.optional(ResourceRequirements),
  cache: Schema.optional(CachePolicy),
  config: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.Unknown })),
});
export type PipelineNode = typeof PipelineNode.Type;

/**
 * 架构文档 §6.2：TaskEvent。相对文档补了 taskId 字段——
 * Worker Pool 复用同一 Worker 跑多个任务，事件必须可归因。
 */
export const TaskEvent = Schema.Union(
  Schema.Struct({
    type: Schema.Literal("progress"),
    taskId: Schema.String,
    value: Schema.Number,
  }),
  Schema.Struct({
    type: Schema.Literal("chunk"),
    taskId: Schema.String,
    artifact: ArtifactRef,
  }),
  Schema.Struct({
    type: Schema.Literal("completed"),
    taskId: Schema.String,
    outputs: Schema.Array(ArtifactRef),
    /** false 表示本次结果是降级/瞬态结果，Scheduler 不写入任务缓存。 */
    cacheable: Schema.optional(Schema.Boolean),
  }),
  Schema.Struct({
    type: Schema.Literal("failed"),
    taskId: Schema.String,
    error: Schema.String,
  }),
);
export type TaskEvent = typeof TaskEvent.Type;

export const decodeTaskEvent = Schema.decodeUnknown(TaskEvent);
