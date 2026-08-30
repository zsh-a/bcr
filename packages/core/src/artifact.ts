import type { BinaryStore } from "@bcr/storage-opfs";
import { Context, Effect, Layer } from "effect";
import { ArtifactNotFound } from "./errors";
import type { ArtifactRef, ComputeTask } from "./schema";

/**
 * Artifact 存取 + DAG 血缘（架构文档 §3）。
 *
 * 二进制数据按 ref.storage 分派到底层 BinaryStore；
 * 血缘关系（谁生产、谁消费）支撑 cancel descendants / 下游失效。
 */
export interface ArtifactStore {
  readonly put: (ref: ArtifactRef, data: Uint8Array) => Effect.Effect<void>;
  readonly get: (ref: ArtifactRef) => Effect.Effect<Uint8Array, ArtifactNotFound>;
  readonly putStream: (ref: ArtifactRef, stream: ReadableStream<Uint8Array>) => Effect.Effect<void>;
  readonly getStream: (
    ref: ArtifactRef,
  ) => Effect.Effect<ReadableStream<Uint8Array>, ArtifactNotFound>;
  readonly delete: (ref: ArtifactRef) => Effect.Effect<void>;
  readonly has: (ref: ArtifactRef) => Effect.Effect<boolean>;

  /** 提交任务时登记消费关系（task → inputs），支撑运行中任务的下游级联取消。 */
  readonly registerConsumption: (task: ComputeTask) => Effect.Effect<void>;

  /** 任务完成时登记产出关系（outputs ← taskId）。 */
  readonly registerProduction: (
    taskId: string,
    outputs: ReadonlyArray<ArtifactRef>,
  ) => Effect.Effect<void>;

  /** 直接消费该 artifact 的任务 id。 */
  readonly consumersOf: (artifactId: string) => Effect.Effect<ReadonlyArray<string>>;

  /** 任务产出的 artifact id 列表。 */
  readonly outputsOf: (taskId: string) => Effect.Effect<ReadonlyArray<string>>;
}

export class ArtifactStoreTag extends Context.Tag("bcr/ArtifactStore")<
  ArtifactStoreTag,
  ArtifactStore
>() {}

/** artifact 在 BinaryStore 中的路径约定；Worker 直读 OPFS 时使用同一约定（§4）。 */
export function artifactPath(ref: Pick<ArtifactRef, "id">): string {
  return `artifacts/${ref.id}`;
}

/**
 * @param stores 按 storage 类型分派的 BinaryStore（memory/opfs/...）。
 * 未配置的 storage 类型落到第一个 store（降级）。
 */
export function artifactStore(
  stores: Readonly<Record<string, BinaryStore>>,
): Layer.Layer<ArtifactStoreTag> {
  return Layer.sync(ArtifactStoreTag, () => {
    const producedBy = new Map<string, string>();
    const consumes = new Map<string, Set<string>>();
    const outputs = new Map<string, string[]>();

    const backend = (ref: ArtifactRef): BinaryStore => {
      const store = stores[ref.storage] ?? Object.values(stores)[0];
      if (store === undefined) {
        throw new Error(`no BinaryStore configured for storage "${ref.storage}"`);
      }
      return store;
    };

    const pathOf = (ref: ArtifactRef): string => artifactPath(ref);

    return {
      put: (ref, data) => Effect.promise(() => backend(ref).put(pathOf(ref), data)),
      get: (ref) =>
        Effect.promise(() => backend(ref).get(pathOf(ref))).pipe(
          Effect.flatMap((data) =>
            data === undefined
              ? Effect.fail(new ArtifactNotFound({ artifactId: ref.id }))
              : Effect.succeed(data),
          ),
        ),
      putStream: (ref, stream) => Effect.promise(() => backend(ref).putStream(pathOf(ref), stream)),
      getStream: (ref) =>
        Effect.promise(() => backend(ref).getStream(pathOf(ref))).pipe(
          Effect.flatMap((stream) =>
            stream === undefined
              ? Effect.fail(new ArtifactNotFound({ artifactId: ref.id }))
              : Effect.succeed(stream),
          ),
        ),
      delete: (ref) => Effect.promise(() => backend(ref).delete(pathOf(ref))),
      has: (ref) => Effect.promise(() => backend(ref).has(pathOf(ref))),

      registerConsumption: (task) =>
        Effect.sync(() => {
          for (const input of task.inputs) {
            const set = consumes.get(input.id) ?? new Set<string>();
            set.add(task.id);
            consumes.set(input.id, set);
          }
        }),

      registerProduction: (taskId, outs) =>
        Effect.sync(() => {
          outputs.set(
            taskId,
            outs.map((ref) => ref.id),
          );
          for (const ref of outs) {
            producedBy.set(ref.id, taskId);
          }
        }),

      consumersOf: (artifactId) => Effect.sync(() => [...(consumes.get(artifactId) ?? [])]),

      outputsOf: (taskId) => Effect.sync(() => outputs.get(taskId) ?? []),
    };
  });
}
