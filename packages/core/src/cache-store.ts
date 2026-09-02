import { Context, Effect, Layer } from "effect";
import type { ArtifactRef } from "./schema";
import {
  selectRetentionCandidates,
  type RetentionOptions,
  type RetentionReason,
} from "./retention";

/**
 * 架构文档 §7：缓存条目。命中后直接得到任务输出 ArtifactRef 列表。
 * SQLite 持久化版本由 storage-sqlite 的 cache_entries 表实现，
 * 与内存版接口一致，UI 不感知 SQL（§8）。
 */
export interface CacheEntry {
  readonly key: string;
  readonly outputs: ReadonlyArray<ArtifactRef>;
  readonly createdAt: number;
  /** 与该缓存 key 关联的历史任务实例。 */
  readonly taskIds: ReadonlyArray<string>;
}

export interface CachePruneOptions extends RetentionOptions {
  /** 显式保护的 key；运行中任务由 Scheduler 自动追加。 */
  readonly protectedKeys?: ReadonlyArray<string> | undefined;
}

export interface CachePruneCandidate extends CacheEntry {
  readonly reason: RetentionReason;
}

export interface CachePrunePlan {
  readonly plannedAt: number;
  readonly now: number;
  readonly scannedEntries: number;
  readonly candidates: ReadonlyArray<CachePruneCandidate>;
  readonly protectedKeys: ReadonlyArray<string>;
  readonly maxAgeMs?: number | undefined;
  readonly maxEntries?: number | undefined;
}

export type CachePruneSkipReason = "missing" | "changed" | "protected" | "remove-failed";

export interface CachePruneSkipped {
  readonly candidate: CachePruneCandidate;
  readonly reason: CachePruneSkipReason;
  readonly error?: string | undefined;
}

export interface CachePruneResult {
  readonly requested: number;
  readonly removed: ReadonlyArray<CachePruneCandidate>;
  readonly skipped: ReadonlyArray<CachePruneSkipped>;
}

/** 纯函数计划器：缓存 key 只按 TTL / 数量治理，不触碰存储。 */
export function planCachePrune(
  entries: ReadonlyArray<CacheEntry>,
  options: CachePruneOptions = {},
): CachePrunePlan {
  const protectedKeys = [...new Set(options.protectedKeys ?? [])];
  const protectedSet = new Set(protectedKeys);
  const selection = selectRetentionCandidates(entries, {
    ...options,
    keyOf: (entry) => entry.key,
    createdAtOf: (entry) => entry.createdAt,
    isProtected: (entry) => protectedSet.has(entry.key),
  });
  return {
    plannedAt: Date.now(),
    now: selection.now,
    scannedEntries: entries.length,
    candidates: selection.candidates.map(({ item, reason }) => ({ ...item, reason })),
    protectedKeys,
    ...(options.maxAgeMs === undefined ? {} : { maxAgeMs: options.maxAgeMs }),
    ...(options.maxEntries === undefined ? {} : { maxEntries: options.maxEntries }),
  };
}

function serializedOutputs(outputs: ReadonlyArray<ArtifactRef>): string {
  return JSON.stringify(outputs);
}

/** 二次校验并逐项删除缓存；删除失败不会阻断其余候选。 */
export function reclaimCachePrune(
  plan: CachePrunePlan,
  current: ReadonlyArray<CacheEntry>,
  remove: (key: string) => Effect.Effect<void>,
  options?: Pick<CachePruneOptions, "protectedKeys">,
): Effect.Effect<CachePruneResult> {
  const protectedKeys = new Set(options?.protectedKeys ?? plan.protectedKeys);
  const byKey = new Map(current.map((entry) => [entry.key, entry]));
  return Effect.gen(function* () {
    const removed: CachePruneCandidate[] = [];
    const skipped: CachePruneSkipped[] = [];
    for (const candidate of plan.candidates) {
      if (protectedKeys.has(candidate.key)) {
        skipped.push({ candidate, reason: "protected" });
        continue;
      }
      const fresh = byKey.get(candidate.key);
      if (fresh === undefined) {
        skipped.push({ candidate, reason: "missing" });
        continue;
      }
      if (
        fresh.createdAt !== candidate.createdAt ||
        serializedOutputs(fresh.outputs) !== serializedOutputs(candidate.outputs) ||
        fresh.taskIds.join("\0") !== candidate.taskIds.join("\0")
      ) {
        skipped.push({ candidate, reason: "changed" });
        continue;
      }
      const result = yield* Effect.either(remove(candidate.key));
      if (result._tag === "Right") {
        removed.push(candidate);
      } else {
        const reason: unknown = result.left;
        skipped.push({
          candidate,
          reason: "remove-failed",
          error: reason instanceof Error ? reason.message : String(reason),
        });
      }
    }
    return { requested: plan.candidates.length, removed, skipped };
  });
}

export interface CacheStore {
  readonly get: (key: string) => Effect.Effect<ReadonlyArray<ArtifactRef> | undefined>;
  readonly put: (
    key: string,
    outputs: ReadonlyArray<ArtifactRef>,
    taskId?: string,
  ) => Effect.Effect<void>;
  /** 缓存命中时把本次任务实例关联到已有 key，供跨会话 DAG 失效使用。 */
  readonly associate: (key: string, taskId: string) => Effect.Effect<void>;
  readonly remove: (key: string) => Effect.Effect<void>;
  /** 按历史任务实例删除对应缓存；任务到 key 的关联必须可持久化。 */
  readonly removeForTask: (taskId: string) => Effect.Effect<void>;
  /** 返回缓存元数据，不读取 Artifact 内容。 */
  readonly entries: Effect.Effect<ReadonlyArray<CacheEntry>>;
  readonly planPrune: (options?: CachePruneOptions) => Effect.Effect<CachePrunePlan>;
  readonly reclaim: (
    plan: CachePrunePlan,
    options?: Pick<CachePruneOptions, "protectedKeys">,
  ) => Effect.Effect<CachePruneResult>;
}

export class CacheStoreTag extends Context.Tag("bcr/CacheStore")<CacheStoreTag, CacheStore>() {}

export function memoryCacheStore(): Layer.Layer<CacheStoreTag> {
  return Layer.sync(CacheStoreTag, () => {
    const entries = new Map<string, { outputs: ReadonlyArray<ArtifactRef>; createdAt: number }>();
    const keyByTask = new Map<string, string>();

    const removeKey = (key: string): void => {
      entries.delete(key);
      for (const [taskId, taskKey] of keyByTask) {
        if (taskKey === key) keyByTask.delete(taskId);
      }
    };

    const snapshot = (): ReadonlyArray<CacheEntry> =>
      [...entries.entries()]
        .map(([key, entry]) => ({
          key,
          outputs: entry.outputs,
          createdAt: entry.createdAt,
          taskIds: [...keyByTask]
            .filter(([, taskKey]) => taskKey === key)
            .map(([taskId]) => taskId)
            .sort(),
        }))
        .sort(
          (left, right) => right.createdAt - left.createdAt || left.key.localeCompare(right.key),
        );

    const remove = (key: string): Effect.Effect<void> => Effect.sync(() => removeKey(key));

    return {
      get: (key) => Effect.sync(() => entries.get(key)?.outputs),
      put: (key, outputs, taskId) =>
        Effect.sync(() => {
          entries.set(key, { outputs: [...outputs], createdAt: Date.now() });
          if (taskId !== undefined) keyByTask.set(taskId, key);
        }),
      associate: (key, taskId) => Effect.sync(() => void keyByTask.set(taskId, key)),
      remove,
      removeForTask: (taskId) =>
        Effect.sync(() => {
          const key = keyByTask.get(taskId);
          if (key !== undefined) removeKey(key);
          else keyByTask.delete(taskId);
        }),
      entries: Effect.sync(snapshot),
      planPrune: (options) =>
        Effect.map(Effect.sync(snapshot), (items) => planCachePrune(items, options)),
      reclaim: (plan, options) =>
        Effect.flatMap(Effect.sync(snapshot), (items) =>
          reclaimCachePrune(plan, items, remove, options),
        ),
    };
  });
}
