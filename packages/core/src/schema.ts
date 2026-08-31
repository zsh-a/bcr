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
  /** 当前任务中的逻辑端口名；同类型多输入时用于消除歧义。 */
  port: Schema.optional(Schema.String),
  format: Schema.optional(Schema.String),
  hash: Schema.optional(Schema.String),
});
export type ArtifactRef = typeof ArtifactRef.Type;

/** 任务输出位声明：执行前不知道 id/hash，只声明类型与存储约束。 */
export const ArtifactSpec = Schema.Struct({
  /** 输出端口名；Pipeline binding 通过它选择上游的具体输出。 */
  name: Schema.optional(Schema.String),
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

/** Pipeline 数据边：把上游的命名输出绑定到当前节点的命名输入。 */
export const PipelineBinding = Schema.Struct({
  from: Schema.String,
  output: Schema.String,
  input: Schema.String,
});
export type PipelineBinding = typeof PipelineBinding.Type;

/**
 * 流水线节点（§3 DAG 的正向编排）：声明依赖和数据端口绑定。
 * 旧数据可以仅提供 after，调度器仍按依赖声明顺序拼接上游输出。
 */
export const PipelineNode = Schema.Struct({
  id: Schema.String,
  runtime: RuntimeKind,
  operation: Schema.String,
  /** 依赖的节点 id；全部完成后其输出按依赖声明顺序拼接为 inputs。 */
  after: Schema.optional(Schema.Array(Schema.String)),
  /** 命名数据边；存在时只注入绑定选中的上游输出，并按本数组顺序排列。 */
  bindings: Schema.optional(Schema.Array(PipelineBinding)),
  /**
   * 外部输入 artifact（根节点消费已有数据用，如源文件）；
   * 实例化时置于依赖输出之前；port 可标记它绑定的根节点输入。
   */
  inputs: Schema.optional(Schema.Array(ArtifactRef)),
  outputs: Schema.Array(ArtifactSpec),
  resources: Schema.optional(ResourceRequirements),
  cache: Schema.optional(CachePolicy),
  config: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.Unknown })),
});
export type PipelineNode = typeof PipelineNode.Type;

export const TaskJournalStatus = Schema.Literal(
  "queued",
  "running",
  "completed",
  "failed",
  "cancelled",
  "blocked",
);
export type TaskJournalStatus = typeof TaskJournalStatus.Type;

/** 可持久化任务快照：TaskJournal 的跨会话恢复格式。 */
export const TaskJournalEntry = Schema.Struct({
  task: ComputeTask,
  status: TaskJournalStatus,
  createdAt: Schema.Number,
  updatedAt: Schema.Number,
  attempts: Schema.Number,
  outputs: Schema.optional(Schema.Array(ArtifactRef)),
  error: Schema.optional(Schema.String),
});
export type TaskJournalEntry = typeof TaskJournalEntry.Type;
export const decodeTaskJournalEntry = Schema.decodeUnknown(TaskJournalEntry);

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
