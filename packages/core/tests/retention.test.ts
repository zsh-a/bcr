import { Context, Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";
import {
  CacheStoreTag,
  memoryCacheStore,
  planCachePrune,
  type ArtifactRef,
  type CacheEntry,
  type CacheStore,
  type ComputeTask,
  makeMemoryTaskJournal,
  type TaskJournal,
  type TaskJournalEntry,
} from "../src";

const output: ArtifactRef = { id: "out", type: "test/result", storage: "memory" };

async function makeCache(): Promise<CacheStore> {
  const context = await Effect.runPromise(Effect.scoped(Layer.build(memoryCacheStore())));
  return Context.get(context, CacheStoreTag);
}

function task(id: string): ComputeTask {
  return { id, runtime: "js", operation: "test.retention", inputs: [], outputs: [] };
}

describe("retention policies", () => {
  it("CacheStore planPrune 支持 TTL、数量上限与保护 key", async () => {
    const cache = await makeCache();
    await Effect.runPromise(cache.put("old", [output]));
    await Effect.runPromise(cache.put("new", [output]));
    const entries = await Effect.runPromise(cache.entries);
    const newest = Math.max(...entries.map((entry) => entry.createdAt));
    const plan = await Effect.runPromise(
      cache.planPrune({ now: newest + 10_000, maxAgeMs: 1_000, protectedKeys: ["old"] }),
    );
    expect(plan.scannedEntries).toBe(2);
    expect(plan.candidates.map(({ key }) => key)).toEqual(["new"]);
    expect(plan.candidates[0]?.reason).toBe("expired");

    const overLimit = await Effect.runPromise(cache.planPrune({ maxEntries: 1 }));
    expect(overLimit.candidates.map(({ key }) => key)).toEqual(["old"]);
    expect(overLimit.candidates[0]?.reason).toBe("over-limit");
  });

  it("CacheStore reclaim 在条目变化时跳过，在稳定时删除", async () => {
    const cache = await makeCache();
    await Effect.runPromise(cache.put("stale", [output]));
    const plan = await Effect.runPromise(cache.planPrune({ maxEntries: 0 }));
    await Effect.runPromise(cache.associate("stale", "new-task"));
    const changed = await Effect.runPromise(cache.reclaim(plan));
    expect(changed.removed).toEqual([]);
    expect(changed.skipped[0]).toMatchObject({ reason: "changed" });
    expect(await Effect.runPromise(cache.get("stale"))).toEqual([output]);

    const stable = await Effect.runPromise(cache.planPrune({ maxEntries: 0 }));
    const removed = await Effect.runPromise(cache.reclaim(stable));
    expect(removed.removed.map(({ key }) => key)).toEqual(["stale"]);
    expect(await Effect.runPromise(cache.get("stale"))).toBeUndefined();
  });

  it("TaskJournal 只治理终态，运行中记录和保护任务不会进入候选", async () => {
    const journal = makeMemoryTaskJournal();
    await Effect.runPromise(journal.recordSubmitted(task("queued")));
    await Effect.runPromise(journal.recordSubmitted(task("done")));
    await Effect.runPromise(journal.recordCompleted("done", [output]));
    const entries = await Effect.runPromise(journal.entries);
    const done = entries.find((entry) => entry.task.id === "done") as TaskJournalEntry;
    const plan = await Effect.runPromise(
      journal.planPrune({
        now: done.createdAt + 10_000,
        maxAgeMs: 1_000,
        protectedTaskIds: ["done"],
      }),
    );
    expect(plan.activeEntries).toBe(1);
    expect(plan.candidates).toEqual([]);

    const expired = await Effect.runPromise(
      journal.planPrune({ now: done.createdAt + 10_000, maxAgeMs: 1_000 }),
    );
    expect(expired.candidates.map(({ entry }) => entry.task.id)).toEqual(["done"]);
    expect(expired.candidates[0]?.reason).toBe("expired");
  });

  it("TaskJournal reclaim 检测状态变化并保留新版本", async () => {
    const journal: TaskJournal = makeMemoryTaskJournal();
    await Effect.runPromise(journal.recordSubmitted(task("mutable")));
    await Effect.runPromise(journal.recordCompleted("mutable", []));
    const plan = await Effect.runPromise(journal.planPrune({ maxEntries: 0 }));
    await Effect.runPromise(journal.recordFailed("mutable", "retryable"));
    const result = await Effect.runPromise(journal.reclaim(plan));
    expect(result.removed).toEqual([]);
    expect(result.skipped[0]).toMatchObject({ reason: "changed" });
    expect((await Effect.runPromise(journal.entries))[0]?.status).toBe("failed");
  });

  it("retention 输入不被修改，且相同时间按 key 稳定排序", () => {
    const entries: CacheEntry[] = [
      { key: "b", outputs: [], createdAt: 1, taskIds: [] },
      { key: "a", outputs: [], createdAt: 1, taskIds: [] },
    ];
    const original = [...entries];
    expect(planCachePrune(entries, { maxEntries: 1 }).candidates.map(({ key }) => key)).toEqual([
      "b",
    ]);
    expect(entries).toEqual(original);
  });
});
