import {
  ArtifactStoreTag,
  artifactStore,
  executorRegistry,
  Executors,
  memoryCacheStore,
  schedulerLive,
  SchedulerTag,
} from "@bcr/core";
import type { RuntimeServices } from "@bcr/react";
import { workerExecutor, WorkerPool } from "@bcr/runtime-worker";
import { isOpfsSupported, MemoryStore, OpfsStore } from "@bcr/storage-opfs";
import { Context, Effect, Layer } from "effect";

/**
 * 组装 Runtime（架构文档 §1 分层）：
 * Scheduler(Effect) → WorkerExecutor → compute.worker → WASM kernel
 * Artifact 存储：memory + opfs（无 OPFS 环境降级为全内存）。
 */
export async function createRuntimeServices(): Promise<RuntimeServices> {
  const opfs = isOpfsSupported() ? new OpfsStore("demo") : new MemoryStore();
  const memory = new MemoryStore();

  const artifactsCtx = await Effect.runPromise(
    Effect.scoped(Layer.build(artifactStore({ memory, opfs }))),
  );
  const artifacts = Context.get(artifactsCtx, ArtifactStoreTag);

  // §5：compute.worker → Rust WASM；Worker 常驻，任务按需分发
  const pool = new WorkerPool(
    1,
    () =>
      new Worker(new URL("./workers/compute.worker.ts", import.meta.url), {
        type: "module",
      }),
  );
  const wasmExecutor = workerExecutor(pool, "wasm", "bcr-kernels-0.2.0", artifacts);

  const deps = Layer.mergeAll(
    Layer.succeed(ArtifactStoreTag, artifacts),
    memoryCacheStore(),
    Layer.succeed(Executors, executorRegistry([wasmExecutor])),
  );
  const live = Layer.provideMerge(schedulerLive, deps);
  const ctx = await Effect.runPromise(Effect.scoped(Layer.build(live)));

  return { scheduler: Context.get(ctx, SchedulerTag), artifacts };
}
