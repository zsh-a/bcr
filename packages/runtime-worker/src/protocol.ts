import { Schema } from "effect";
import { ArtifactRef, ComputeTask } from "@bcr/core";

/**
 * 架构文档 §6.2：typed MessagePort 协议（不使用 Comlink）。
 *
 * 通道布局：
 * - Worker 控制通道（self / worker 全局 onmessage）：run / cancel 命令。
 * - 每个任务一条 MessageChannel：run 命令 transfer port 给 Worker，
 *   任务事件（progress/chunk/completed/failed）在该 port 上回流。
 *
 * 相对核心 TaskEvent 的差异：chunk 事件可携带二进制 data
 * （Transferable 零拷贝，§4 small 通道），仅用于 storage=memory 的产物；
 * storage=opfs 的产物由 Worker 直接写 OPFS，事件里只带 ref。
 */

export const RunCommand = Schema.Struct({
  type: Schema.Literal("run"),
  task: ComputeTask,
});
export const CancelCommand = Schema.Struct({
  type: Schema.Literal("cancel"),
  taskId: Schema.String,
});

/** 控制通道消息。run 命令实际传输时附带 MessagePort（无法进 Schema）。 */
export const WorkerCommand = Schema.Union(RunCommand, CancelCommand);
export type WorkerCommand = typeof WorkerCommand.Type;

export interface RunCommandMessage {
  readonly type: "run";
  readonly task: typeof ComputeTask.Type;
  readonly port: MessagePort;
}

export const decodeWorkerCommand = Schema.decodeUnknownEither(WorkerCommand);

export const ProgressEvent = Schema.Struct({
  type: Schema.Literal("progress"),
  taskId: Schema.String,
  value: Schema.Number,
});
export const ChunkEvent = Schema.Struct({
  type: Schema.Literal("chunk"),
  taskId: Schema.String,
  artifact: ArtifactRef,
});
export const CompletedEvent = Schema.Struct({
  type: Schema.Literal("completed"),
  taskId: Schema.String,
  outputs: Schema.Array(ArtifactRef),
});
export const FailedEvent = Schema.Struct({
  type: Schema.Literal("failed"),
  taskId: Schema.String,
  error: Schema.String,
});

export const WorkerEvent = Schema.Union(ProgressEvent, ChunkEvent, CompletedEvent, FailedEvent);
export type WorkerEvent = typeof WorkerEvent.Type;

/** chunk 事件实际传输时附带 data?: Uint8Array（Transferable）。 */
export interface ChunkEventMessage {
  readonly type: "chunk";
  readonly taskId: string;
  readonly artifact: typeof ArtifactRef.Type;
  readonly data?: Uint8Array;
}

export const decodeWorkerEvent = Schema.decodeUnknownEither(WorkerEvent);
