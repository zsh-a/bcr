import {
  artifactStore,
  ArtifactStoreTag,
  createTaskState,
  TaskFailed,
  type ArtifactRef,
  type TaskHandle,
} from "@bcr/core";
import { MemoryStore } from "@bcr/storage-opfs";
import { Context, Deferred, Effect, Layer, Stream } from "effect";
import { describe, expect, it, vi } from "vitest";
import { createMangaPipeline } from "../src/execution/pipeline";
import type { MangaComputeServices } from "../src/execution/execution-context";
import { MangaModelRegistry } from "../src/models/model-registry";
import { resolveMangaOcrAdapter } from "../src/models/resolution";
import { MangaStore } from "../src/project/store";

describe("Manga pipeline ownership", () => {
  it("cancels only the task handles owned by its own session", async () => {
    const resources = await Effect.runPromise(
      Effect.scoped(Layer.build(artifactStore({ memory: new MemoryStore() }))),
    );
    const artifacts = Context.get(resources, ArtifactStoreTag);
    const submitted: Array<{
      deferred: Deferred.Deferred<ReadonlyArray<ArtifactRef>, TaskFailed>;
      ready: Deferred.Deferred<void>;
      cancelled: number;
    }> = [];
    const services: MangaComputeServices = {
      artifacts,
      scheduler: {
        submit: (task) =>
          Effect.gen(function* () {
            const deferred = yield* Deferred.make<ReadonlyArray<ArtifactRef>, TaskFailed>();
            const ready = yield* Deferred.make<void>();
            const operation = { deferred, ready, cancelled: 0 };
            submitted.push(operation);
            const handle: TaskHandle = {
              taskId: task.id,
              state: createTaskState({ status: "running", progress: 0 }),
              events: Stream.empty,
              cached: false,
              await: Deferred.await(deferred),
              cancel: Effect.gen(function* () {
                operation.cancelled++;
                yield* Deferred.fail(
                  deferred,
                  new TaskFailed({ taskId: task.id, message: "cancelled" }),
                );
              }),
            };
            yield* Deferred.await(ready);
            return handle;
          }),
      },
    };
    const models = [new MangaModelRegistry(undefined), new MangaModelRegistry(undefined)];
    const pipelines = models.map((models) =>
      createMangaPipeline({ artifacts, models, store: new MangaStore() }),
    );
    const execution = resolveMangaOcrAdapter("vision.onnx", "en", { device: "wasm" }).execution;
    const first = pipelines[0]!.preloadMangaModel(services, execution);
    const firstResult = expect(first).rejects.toThrow(/cancelled|已取消/u);
    const second = pipelines[1]!.preloadMangaModel(services, execution);
    try {
      await vi.waitFor(() => expect(submitted).toHaveLength(2));
      pipelines[0]!.cancelMangaQueue();
      await Effect.runPromise(Deferred.succeed(submitted[0]!.ready, undefined));
      await firstResult;
      expect(submitted.map((operation) => operation.cancelled)).toEqual([1, 0]);
      await Effect.runPromise(Deferred.succeed(submitted[1]!.ready, undefined));
      await Effect.runPromise(Deferred.succeed(submitted[1]!.deferred, []));
      await expect(second).resolves.toBe(true);
    } finally {
      pipelines.forEach((pipeline) => pipeline.cancelMangaQueue());
      await Promise.all(
        submitted.map((operation) =>
          Effect.runPromise(Deferred.succeed(operation.ready, undefined)),
        ),
      );
      await Promise.allSettled([first, second]);
      await Promise.all(models.map((models) => models.close()));
    }
  });
});
