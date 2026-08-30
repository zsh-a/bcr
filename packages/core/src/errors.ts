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

export type SchedulerError = TaskFailed | ArtifactNotFound | NoExecutor;
