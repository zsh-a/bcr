import {
  ArtifactStoreTag,
  artifactStore,
  executorRegistry,
  Executors,
  memoryCacheStore,
  schedulerLive,
  SchedulerTag,
  type ArtifactRef,
  type ComputeTask,
} from "@bcr/core";
import type { RuntimeServices } from "@bcr/react";
import { workerExecutor, WorkerPool } from "@bcr/runtime-worker";
import { isOpfsSupported, MemoryStore, OpfsStore } from "@bcr/storage-opfs";
import { Context, Effect, Layer, Stream } from "effect";
import { studio, type TaskRecord } from "./store";

let taskSeq = 0;

/** 组装 Compute Runtime 并接入 Studio 状态投影。 */
export async function createRuntimeServices(): Promise<RuntimeServices> {
  const opfs = isOpfsSupported() ? new OpfsStore("studio") : new MemoryStore();
  const memory = new MemoryStore();

  const artifactsCtx = await Effect.runPromise(
    Effect.scoped(Layer.build(artifactStore({ memory, opfs }))),
  );
  const artifacts = Context.get(artifactsCtx, ArtifactStoreTag);

  const pool = new WorkerPool(
    Math.max(1, (navigator.hardwareConcurrency ?? 2) - 1),
    () =>
      new Worker(new URL("./workers/compute.worker.ts", import.meta.url), {
        type: "module",
      }),
  );
  const wasmExecutor = workerExecutor(pool, "wasm", "bcr-kernels-0.1.0", artifacts);

  const deps = Layer.mergeAll(
    Layer.succeed(ArtifactStoreTag, artifacts),
    memoryCacheStore(),
    Layer.succeed(Executors, executorRegistry([wasmExecutor])),
  );
  const live = Layer.provideMerge(schedulerLive, deps);
  const ctx = await Effect.runPromise(Effect.scoped(Layer.build(live)));

  return { scheduler: Context.get(ctx, SchedulerTag), artifacts };
}

/** 提交任务并把事件流投影到 Studio store。 */
export async function runTask(
  services: RuntimeServices,
  input: ArtifactRef,
  operation: "hash.blake3" | "audio.waveform",
  sizeBytes?: number,
): Promise<void> {
  taskSeq += 1;
  const task: ComputeTask = {
    id: `task-${taskSeq}`,
    runtime: "wasm",
    operation,
    inputs: [input],
    outputs: [{ type: "studio/result" }],
    cache: { enabled: true },
    ...(sizeBytes !== undefined ? { config: { sizeBytes } } : {}),
  };

  const handle = await Effect.runPromise(services.scheduler.submit(task));

  const record: TaskRecord = {
    id: task.id,
    operation,
    runtime: task.runtime,
    inputId: input.id,
    status: "running",
    progress: 0,
    cached: false,
    startedAt: Date.now(),
  };
  studio.upsertTask(record);

  if (handle.cached) {
    const outputs = await Effect.runPromise(handle.await);
    studio.upsertTask({
      ...record,
      status: "completed",
      progress: 1,
      cached: true,
      outputs,
      durationMs: Date.now() - record.startedAt,
    });
    studio.log("ok", `${operation} · cache hit · ${input.id}`);
    return;
  }

  studio.log("info", `${operation} · submitted · ${input.id}`);

  Effect.runFork(
    Stream.runForEach(handle.events, (event) =>
      Effect.sync(() => {
        switch (event.type) {
          case "progress":
            studio.patchTask(task.id, { progress: event.value });
            break;
          case "chunk":
            break;
          case "completed":
            studio.patchTask(task.id, {
              status: "completed",
              progress: 1,
              outputs: event.outputs,
              durationMs: Date.now() - record.startedAt,
            });
            studio.log("ok", `${operation} · completed · ${task.id}`);
            break;
          case "failed":
            studio.patchTask(task.id, {
              status: event.error === "cancelled" ? "cancelled" : "failed",
              error: event.error,
              durationMs: Date.now() - record.startedAt,
            });
            studio.log("error", `${operation} · ${event.error} · ${task.id}`);
            break;
        }
      }),
    ),
  );
}

/** 导入文件：流式写入 OPFS（FileArtifact），不整段进内存（§4/§8）。 */
export async function importFile(services: RuntimeServices, file: File): Promise<void> {
  const ref: ArtifactRef = {
    id: `source/${file.name}`,
    type: `file/${file.name.split(".").pop() ?? "bin"}`,
    storage: "opfs",
  };
  await Effect.runPromise(services.artifacts.putStream(ref, file.stream()));
  studio.addFile({
    ref,
    name: file.name,
    size: file.size,
    addedAt: Date.now(),
  });
  studio.log("info", `import · ${file.name} · ${file.size} bytes → opfs`);
}

export async function cancelTask(services: RuntimeServices, taskId: string): Promise<void> {
  await Effect.runPromise(services.scheduler.cancel(taskId));
  studio.log("warn", `cancel · ${taskId}`);
}
