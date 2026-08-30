import { Data } from "effect";

export class TaskFailed extends Data.TaggedError("TaskFailed")<{
  readonly taskId: string;
  readonly message: string;
}> {}

export class ArtifactNotFound extends Data.TaggedError("ArtifactNotFound")<{
  readonly artifactId: string;
}> {}

export class NoExecutor extends Data.TaggedError("NoExecutor")<{
  readonly runtime: string;
}> {}

/** 流水线图非法：重复节点 id、未知依赖或存在环（§3 DAG）。 */
export class InvalidPipeline extends Data.TaggedError("InvalidPipeline")<{
  readonly pipelineId: string;
  readonly message: string;
}> {}

export type SchedulerError = TaskFailed | ArtifactNotFound | NoExecutor;
