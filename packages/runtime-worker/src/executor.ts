import {
  TaskFailed,
  type ArtifactStore,
  type ComputeTask,
  type RuntimeExecutor,
  type RuntimeKind,
  type TaskEvent,
} from "@bcr/core";
import { Chunk, Effect, Either, Option, Stream } from "effect";
import { decodeWorkerEvent, type ChunkEventMessage } from "./protocol";
import type { WorkerPool } from "./pool";

/**
 * 把 Worker 适配成核心 RuntimeExecutor（架构文档 §5/§6.2）。
 *
 * 每次 run 建立一条 MessageChannel（port 经 transfer 零拷贝移交 Worker），
 * 事件包成 Stream<TaskEvent> 与 Effect Stream 对接；
 * 中断 = 向 Worker 发 cancel 命令 + 关 port，Worker 本身回池复用。
 */
export function workerExecutor(
  pool: WorkerPool,
  runtime: RuntimeKind,
  version: string,
  artifacts: ArtifactStore,
): RuntimeExecutor {
  return {
    runtime,
    version,
    run: (task: ComputeTask): Stream.Stream<TaskEvent, TaskFailed> =>
      Stream.unwrapScoped(
        Effect.gen(function* () {
          // Worker 生命周期 ≠ Task 生命周期：随作用域借还，不随任务销毁。
          const worker = yield* Effect.acquireRelease(
            Effect.promise(() => pool.acquire()),
            (w) => Effect.sync(() => pool.release(w)),
          );

          return Stream.async<TaskEvent, TaskFailed>((emit) => {
            const channel = new MessageChannel();
            const port = channel.port1;

            const single = (event: TaskEvent) => void emit(Effect.succeed(Chunk.of(event)));

            const listener = (event: MessageEvent) => {
              const decoded = decodeWorkerEvent(event.data);
              if (Either.isLeft(decoded)) {
                // 非法消息容错：不进流，避免污染下游
                return;
              }
              const message = decoded.right;
              switch (message.type) {
                case "progress":
                  single(message);
                  break;
                case "chunk": {
                  // memory 产物随事件携带字节，落进 ArtifactStore（§3/§4）；
                  // 落库完成后才发出事件，保证下游 completed 时可读
                  const data = (event.data as ChunkEventMessage).data;
                  if (data !== undefined) {
                    void emit(
                      artifacts
                        .put(message.artifact, data)
                        .pipe(
                          Effect.mapError(Option.some),
                          Effect.as(Chunk.of<TaskEvent>(message)),
                        ),
                    );
                  } else {
                    single(message);
                  }
                  break;
                }
                case "completed":
                  single(message);
                  void emit(Effect.fail(Option.none()));
                  break;
                case "failed":
                  single(message);
                  void emit(
                    Effect.fail(
                      Option.some(
                        new TaskFailed({
                          taskId: message.taskId,
                          message: message.error,
                        }),
                      ),
                    ),
                  );
                  break;
              }
            };

            port.addEventListener("message", listener);
            port.start();

            worker.postMessage({ type: "run", task, port: channel.port2 }, [channel.port2]);

            // 流结束 / 中断 → cancel + 关 port（§6.1：cancel 语义）
            return Effect.sync(() => {
              port.removeEventListener("message", listener);
              port.close();
              channel.port2.close();
              worker.postMessage({ type: "cancel", taskId: task.id });
            });
          });
        }),
      ),
  };
}
