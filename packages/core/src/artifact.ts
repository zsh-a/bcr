import type { BinaryStore } from "@bcr/storage-opfs";
import { Context, Effect, Layer } from "effect";
import { ArtifactNotFound } from "./errors";
import { noopLineageStore, type LineageSnapshot, type LineageStore } from "./lineage";
import type { ArtifactRef, ComputeTask } from "./schema";

/** 单个 Artifact 的存储清单项（不读取内容，只读取路径与字节数）。 */
export interface ArtifactInventoryEntry {
  /** ArtifactRef.id；路径前缀 `artifacts/` 已剥离。 */
  readonly id: string;
  /** 实际命中的 BinaryStore 名称（通常是 memory / opfs）。 */
  readonly storage: string;
  /** BinaryStore 中的物理路径，便于诊断与后续迁移。 */
  readonly path: string;
  readonly size: number;
}

/** 按存储后端聚合的 Artifact 容量。 */
export interface ArtifactStorageUsage {
  readonly storage: string;
  readonly objects: number;
  readonly bytes: number;
}

export interface ArtifactUsage {
  readonly totalObjects: number;
  readonly totalBytes: number;
  readonly byStorage: ReadonlyArray<ArtifactStorageUsage>;
}

export interface ArtifactInventoryOptions {
  /** 仅返回指定 BinaryStore；缺省时扫描所有已配置后端。 */
  readonly storage?: string;
  /** 按 ArtifactRef.id 前缀过滤，例如 `reader/search-index/`。 */
  readonly idPrefix?: string;
}

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

  /**
   * 列举已物化 Artifact 的轻量清单；不会读取内容本身。
   * 该查询是存储治理 / 调试入口，调用方可据此展示容量或规划安全 GC。
   */
  readonly inventory: (
    options?: ArtifactInventoryOptions,
  ) => Effect.Effect<ReadonlyArray<ArtifactInventoryEntry>>;

  /** 聚合所有 Artifact 的对象数与字节数；同样不读取对象内容。 */
  readonly usage: () => Effect.Effect<ArtifactUsage>;

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
 * @param lineage 血缘持久化（§8）；缺省为 no-op（纯内存，刷新即失）。
 */
export function artifactStore(
  stores: Readonly<Record<string, BinaryStore>>,
  lineage: LineageStore = noopLineageStore(),
): Layer.Layer<ArtifactStoreTag> {
  return Layer.effect(
    ArtifactStoreTag,
    Effect.gen(function* () {
      const snapshot: LineageSnapshot = yield* lineage.load;
      const producedBy = new Map<string, string>();
      const consumes = new Map<string, Set<string>>();
      const outputs = new Map<string, string[]>();

      for (const [taskId, outs] of snapshot.outputs) outputs.set(taskId, [...outs]);
      for (const [artifactId, taskIds] of snapshot.consumers)
        consumes.set(artifactId, new Set(taskIds));

      const backend = (ref: ArtifactRef): BinaryStore => {
        const store = stores[ref.storage] ?? Object.values(stores)[0];
        if (store === undefined) {
          throw new Error(`no BinaryStore configured for storage "${ref.storage}"`);
        }
        return store;
      };

      const pathOf = (ref: ArtifactRef): string => artifactPath(ref);

      const inventory = (
        options: ArtifactInventoryOptions = {},
      ): Effect.Effect<ReadonlyArray<ArtifactInventoryEntry>> =>
        Effect.promise(async () => {
          const idPrefix = options.idPrefix ?? "";
          const selected = Object.entries(stores).filter(
            ([storage]) => options.storage === undefined || storage === options.storage,
          );
          const paths = (
            await Promise.all(
              selected.map(async ([storage, store]) =>
                (await store.list("artifacts/")).map((path) => ({ storage, store, path })),
              ),
            )
          ).flat();
          const entries = await Promise.all(
            paths.map(async ({ storage, store, path }) => {
              const id = path.startsWith("artifacts/") ? path.slice("artifacts/".length) : path;
              if (idPrefix.length > 0 && !id.startsWith(idPrefix)) return undefined;
              const size = await store.size(path);
              return size === undefined ? undefined : { id, storage, path, size };
            }),
          );
          return entries
            .filter((entry): entry is ArtifactInventoryEntry => entry !== undefined)
            .sort((left, right) =>
              left.storage === right.storage
                ? left.id.localeCompare(right.id)
                : left.storage.localeCompare(right.storage),
            );
        });

      const usage = (): Effect.Effect<ArtifactUsage> =>
        inventory().pipe(
          Effect.map((entries) => {
            const byStorage = new Map<string, ArtifactStorageUsage>();
            for (const entry of entries) {
              const current = byStorage.get(entry.storage) ?? {
                storage: entry.storage,
                objects: 0,
                bytes: 0,
              };
              byStorage.set(entry.storage, {
                storage: entry.storage,
                objects: current.objects + 1,
                bytes: current.bytes + entry.size,
              });
            }
            // Include configured stores even when empty, so the UI can distinguish
            // an empty OPFS backend from an unavailable one.
            for (const storage of Object.keys(stores)) {
              if (!byStorage.has(storage)) {
                byStorage.set(storage, { storage, objects: 0, bytes: 0 });
              }
            }
            return {
              totalObjects: entries.length,
              totalBytes: entries.reduce((total, entry) => total + entry.size, 0),
              byStorage: [...byStorage.values()].sort((left, right) =>
                left.storage.localeCompare(right.storage),
              ),
            };
          }),
        );

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
        putStream: (ref, stream) =>
          Effect.promise(() => backend(ref).putStream(pathOf(ref), stream)),
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
        inventory,
        usage,

        registerConsumption: (task) =>
          Effect.gen(function* () {
            const inputIds = [...new Set(task.inputs.map((input) => input.id))];
            for (const input of inputIds) {
              const set = consumes.get(input) ?? new Set<string>();
              set.add(task.id);
              consumes.set(input, set);
            }
            yield* lineage.recordConsumption(task.id, inputIds);
          }),

        registerProduction: (taskId, outs) =>
          Effect.gen(function* () {
            outputs.set(
              taskId,
              outs.map((ref) => ref.id),
            );
            for (const ref of outs) {
              producedBy.set(ref.id, taskId);
            }
            yield* lineage.recordProduction(
              taskId,
              outs.map((ref) => ref.id),
            );
          }),

        consumersOf: (artifactId) => Effect.sync(() => [...(consumes.get(artifactId) ?? [])]),

        outputsOf: (taskId) => Effect.sync(() => outputs.get(taskId) ?? []),
      };
    }),
  );
}
