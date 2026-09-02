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

export interface ArtifactCleanupOptions {
  /** 调用方明确声明仍在使用的根 Artifact（例如项目源文件）。 */
  readonly protectedIds?: ReadonlyArray<string>;
  /** 调用方明确声明仍在使用的命名空间（例如 `reader/search-index/`）。 */
  readonly protectedPrefixes?: ReadonlyArray<string>;
}

export interface ArtifactCleanupCandidate extends ArtifactInventoryEntry {
  readonly reason: "untracked";
}

export interface ArtifactCleanupPlan {
  readonly createdAt: number;
  readonly scannedObjects: number;
  readonly candidates: ReadonlyArray<ArtifactCleanupCandidate>;
  readonly protectedIds: ReadonlyArray<string>;
  readonly protectedPrefixes: ReadonlyArray<string>;
}

export type ArtifactCleanupSkipReason =
  | "missing"
  | "changed"
  | "protected"
  | "tracked"
  | "storage-unavailable"
  | "delete-failed";

export interface ArtifactCleanupSkipped {
  readonly candidate: ArtifactCleanupCandidate;
  readonly reason: ArtifactCleanupSkipReason;
  readonly error?: string | undefined;
}

export interface ArtifactCleanupResult {
  readonly requested: number;
  readonly deleted: ReadonlyArray<ArtifactCleanupCandidate>;
  readonly skipped: ReadonlyArray<ArtifactCleanupSkipped>;
  readonly reclaimedBytes: number;
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
  /**
   * Read an object as a Blob without forcing callers to materialize a large
   * byte array. OPFS-backed stores can return their native file snapshot;
   * memory stores transparently fall back to a Blob copy.
   */
  readonly getBlob: (ref: ArtifactRef) => Effect.Effect<Blob, ArtifactNotFound>;
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

  /** 订阅物理对象变化，UI 可在导入/清理后立即刷新容量，而无需高频轮询。 */
  readonly subscribe: (listener: () => void) => () => void;

  /**
   * 生成只读清理计划：仅把没有血缘记录、也不在调用方保护根/前缀中的
   * Artifact 标成候选，不会修改任何存储。
   */
  readonly planCleanup: (options?: ArtifactCleanupOptions) => Effect.Effect<ArtifactCleanupPlan>;

  /**
   * 执行清理计划。执行前会重新列举并检查 path/size、血缘和保护根；
   * 计划过期或对象发生变化时跳过，不会误删新写入的对象。
   */
  readonly reclaim: (
    plan: ArtifactCleanupPlan,
    options?: ArtifactCleanupOptions,
  ) => Effect.Effect<ArtifactCleanupResult>;

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
      const listeners = new Set<() => void>();
      const notify = (): void => {
        for (const listener of listeners) {
          try {
            listener();
          } catch {
            // Observers are diagnostic/UI side effects; never turn a successful
            // storage mutation into a failed write because a listener crashed.
          }
        }
      };

      for (const [taskId, outs] of snapshot.outputs) outputs.set(taskId, [...outs]);
      for (const [taskId, outs] of snapshot.outputs) {
        for (const artifactId of outs) producedBy.set(artifactId, taskId);
      }
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

      const normalizePrefix = (prefix: string): string => prefix.replace(/^\/+|\/+$/g, "");

      const matchesPrefix = (id: string, prefix: string): boolean => {
        const normalized = normalizePrefix(prefix);
        return normalized.length > 0 && (id === normalized || id.startsWith(`${normalized}/`));
      };

      const protection = (options: ArtifactCleanupOptions = {}) => ({
        ids: new Set(options.protectedIds ?? []),
        prefixes: (options.protectedPrefixes ?? []).map(normalizePrefix).filter(Boolean),
      });

      const isProtected = (id: string, guard: ReturnType<typeof protection>): boolean =>
        guard.ids.has(id) || guard.prefixes.some((prefix) => matchesPrefix(id, prefix));

      const planCleanup = (
        options: ArtifactCleanupOptions = {},
      ): Effect.Effect<ArtifactCleanupPlan> =>
        inventory().pipe(
          Effect.map((entries) => {
            const guard = protection(options);
            const tracked = new Set([...producedBy.keys(), ...consumes.keys()]);
            const candidates = entries
              .filter((entry) => !tracked.has(entry.id) && !isProtected(entry.id, guard))
              .map((entry) => ({ ...entry, reason: "untracked" as const }));
            return {
              createdAt: Date.now(),
              scannedObjects: entries.length,
              candidates,
              protectedIds: [...guard.ids],
              protectedPrefixes: [...guard.prefixes],
            };
          }),
        );

      const reclaim = (
        plan: ArtifactCleanupPlan,
        options?: ArtifactCleanupOptions,
      ): Effect.Effect<ArtifactCleanupResult> =>
        Effect.promise(async () => {
          const guard = protection(
            options ?? {
              protectedIds: plan.protectedIds,
              protectedPrefixes: plan.protectedPrefixes,
            },
          );
          const tracked = new Set([...producedBy.keys(), ...consumes.keys()]);
          const current = await Effect.runPromise(inventory());
          const byPath = new Map(
            current.map((entry) => [`${entry.storage}\0${entry.path}`, entry]),
          );
          const deleted: ArtifactCleanupCandidate[] = [];
          const skipped: ArtifactCleanupSkipped[] = [];

          for (const candidate of plan.candidates) {
            if (isProtected(candidate.id, guard)) {
              skipped.push({ candidate, reason: "protected" });
              continue;
            }
            if (tracked.has(candidate.id)) {
              skipped.push({ candidate, reason: "tracked" });
              continue;
            }
            const key = `${candidate.storage}\0${candidate.path}`;
            const fresh = byPath.get(key);
            if (fresh === undefined) {
              skipped.push({ candidate, reason: "missing" });
              continue;
            }
            if (fresh.size !== candidate.size) {
              skipped.push({ candidate, reason: "changed" });
              continue;
            }
            const store = stores[candidate.storage];
            if (store === undefined) {
              skipped.push({ candidate, reason: "storage-unavailable" });
              continue;
            }
            try {
              await store.delete(candidate.path);
              deleted.push(candidate);
            } catch (error) {
              skipped.push({
                candidate,
                reason: "delete-failed",
                error: error instanceof Error ? error.message : String(error),
              });
            }
          }
          if (deleted.length > 0) notify();
          return {
            requested: plan.candidates.length,
            deleted,
            skipped,
            reclaimedBytes: deleted.reduce((total, entry) => total + entry.size, 0),
          };
        });

      return {
        put: (ref, data) =>
          Effect.promise(async () => {
            await backend(ref).put(pathOf(ref), data);
            notify();
          }),
        get: (ref) =>
          Effect.promise(() => backend(ref).get(pathOf(ref))).pipe(
            Effect.flatMap((data) =>
              data === undefined
                ? Effect.fail(new ArtifactNotFound({ artifactId: ref.id }))
                : Effect.succeed(data),
            ),
          ),
        putStream: (ref, stream) =>
          Effect.promise(async () => {
            await backend(ref).putStream(pathOf(ref), stream);
            notify();
          }),
        getStream: (ref) =>
          Effect.promise(() => backend(ref).getStream(pathOf(ref))).pipe(
            Effect.flatMap((stream) =>
              stream === undefined
                ? Effect.fail(new ArtifactNotFound({ artifactId: ref.id }))
                : Effect.succeed(stream),
            ),
          ),
        getBlob: (ref) =>
          Effect.promise(async () => {
            const store = backend(ref);
            if (store.getBlob !== undefined) {
              return store.getBlob(pathOf(ref));
            }
            const bytes = await store.get(pathOf(ref));
            return bytes === undefined
              ? undefined
              : new Blob([
                  bytes.buffer.slice(
                    bytes.byteOffset,
                    bytes.byteOffset + bytes.byteLength,
                  ) as ArrayBuffer,
                ]);
          }).pipe(
            Effect.flatMap((blob) =>
              blob === undefined
                ? Effect.fail(new ArtifactNotFound({ artifactId: ref.id }))
                : Effect.succeed(blob),
            ),
          ),
        delete: (ref) =>
          Effect.promise(async () => {
            await backend(ref).delete(pathOf(ref));
            notify();
          }),
        has: (ref) => Effect.promise(() => backend(ref).has(pathOf(ref))),
        inventory,
        usage,
        subscribe: (listener) => {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
        planCleanup,
        reclaim,

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
            const previous = outputs.get(taskId) ?? [];
            for (const artifactId of previous) {
              if (producedBy.get(artifactId) === taskId) producedBy.delete(artifactId);
            }
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
