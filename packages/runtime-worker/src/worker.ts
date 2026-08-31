import type { ArtifactRef, ComputeTask } from "@bcr/core";

/**
 * Worker 侧入口（架构文档 §5/§6.2）。
 *
 * 在 worker 文件中调用一次：
 *   defineWorker({ "hash.blake3": async (task, ctx) => [...] })
 *
 * 协议：run 命令携带 MessagePort；progress/chunk/completed/failed 经 port 回流；
 * cancel 命令通过 AbortSignal 暴露给 handler。
 */

export interface WorkerContext {
  /** 收到 cancel 命令时触发；handler 应在合适粒度检查。 */
  readonly signal: AbortSignal;
  progress(value: number): void;
  /**
   * 产出 memory 产物的字节。data 的底层 buffer 会被 transfer（零拷贝，§4），
   * 传入后调用方不得再使用；opfs 产物由 Worker 直写 OPFS，无需 emitChunk。
   */
  emitChunk(ref: ArtifactRef, data?: Uint8Array): void;
}

export type OperationHandler = (
  task: ComputeTask,
  ctx: WorkerContext,
) => Promise<ReadonlyArray<ArtifactRef> | OperationResult>;

/** Operation 可把降级/瞬态结果标为不可缓存，避免污染正常执行缓存。 */
export interface OperationResult {
  readonly outputs: ReadonlyArray<ArtifactRef>;
  readonly cacheable?: boolean;
}

function operationResult(result: ReadonlyArray<ArtifactRef> | OperationResult): OperationResult {
  return Array.isArray(result) ? { outputs: result } : (result as OperationResult);
}

const workerScope = globalThis as unknown as {
  addEventListener(type: "message", listener: (event: MessageEvent) => void): void;
};

export function defineWorker(handlers: Readonly<Record<string, OperationHandler>>): void {
  const controllers = new Map<string, AbortController>();

  workerScope.addEventListener("message", (event: MessageEvent) => {
    const message = event.data as
      | { type: "run"; task: ComputeTask; port: MessagePort }
      | { type: "cancel"; taskId: string };

    if (message.type === "cancel") {
      // 任务可能已结束（主线程流关闭时总会补发 cancel），幂等处理
      controllers.get(message.taskId)?.abort();
      controllers.delete(message.taskId);
      return;
    }

    const { task, port } = message;
    const handler = handlers[task.operation];
    if (handler === undefined) {
      port.postMessage({
        type: "failed",
        taskId: task.id,
        error: `unknown operation: ${task.operation}`,
      });
      port.close();
      return;
    }

    const controller = new AbortController();
    controllers.set(task.id, controller);

    const ctx: WorkerContext = {
      signal: controller.signal,
      progress: (value) => {
        port.postMessage({ type: "progress", taskId: task.id, value });
      },
      emitChunk: (ref, data) => {
        const payload = data !== undefined ? { data } : {};
        port.postMessage(
          { type: "chunk", taskId: task.id, artifact: ref, ...payload },
          data !== undefined ? [data.buffer as Transferable] : [],
        );
      },
    };

    handler(task, ctx)
      .then((rawResult) => {
        const result = operationResult(rawResult);
        port.postMessage({
          type: "completed",
          taskId: task.id,
          outputs: [...result.outputs],
          ...(result.cacheable !== undefined ? { cacheable: result.cacheable } : {}),
        });
      })
      .catch((error: unknown) => {
        port.postMessage({
          type: "failed",
          taskId: task.id,
          error: error instanceof Error ? error.message : String(error),
        });
      })
      .finally(() => {
        controllers.delete(task.id);
        port.close();
      });
  });
}
