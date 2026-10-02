import { describe, expect, it } from "vitest";
import { Context, Effect, Layer } from "effect";
import { MemoryStore } from "@bcr/storage-opfs";
import {
  artifactStore,
  ArtifactStoreTag,
  artifactPath,
  planCachePrune,
  reclaimCachePrune,
  planTaskJournalPrune,
  reclaimTaskJournalPrune,
  type CacheEntry,
  type TaskJournalEntry,
  type ArtifactRef,
} from "@bcr/core";
import { demoResearch } from "../src/jsg/demo";
import { DEFAULT_CONFIG, type JsgResult, type ResearchDataset } from "../src/jsg/model";
import { initialSession, type ResearchSession, type ResearchRun } from "../src/jsg/session";
import {
  planResearchCleanup,
  reclaimResearch,
  rememberSnapshot,
  researchUsage,
  recoverResearchFiles,
  recoverResearchExports,
} from "../src/jsg/storage";

const ref = (id: string, type = "quant/jsg-daily"): ArtifactRef => ({
  id,
  type,
  storage: "opfs",
  hash: id,
  format: "json",
});
async function setup() {
  const store = new MemoryStore();
  const context = await Effect.runPromise(
    Effect.scoped(Layer.build(artifactStore({ opfs: store }))),
  );
  const artifacts = Context.get(context, ArtifactStoreTag);
  const caches: CacheEntry[] = [];
  const journal: TaskJournalEntry[] = [];
  const scheduler = {
    planCachePrune: (options = {}) => Effect.sync(() => planCachePrune(caches, options)),
    reclaimCache: (plan: ReturnType<typeof planCachePrune>) =>
      reclaimCachePrune(plan, caches, (key) =>
        Effect.sync(() => {
          caches.splice(
            caches.findIndex((c) => c.key === key),
            1,
          );
        }),
      ),
    planJournalPrune: (options = {}) => Effect.sync(() => planTaskJournalPrune(journal, options)),
    reclaimJournal: (plan: ReturnType<typeof planTaskJournalPrune>) =>
      reclaimTaskJournalPrune(plan, journal, (id) =>
        Effect.sync(() => {
          journal.splice(
            journal.findIndex((e) => e.task.id === id),
            1,
          );
        }),
      ),
  };
  const put = async (target: ArtifactRef, value: unknown) =>
    store.put(artifactPath(target), new TextEncoder().encode(JSON.stringify(value)));
  const dataset: ResearchDataset = {
    manifest: {
      ...demoResearch().manifest,
      partitions: [{ file: "daily.arrow", bytes: 1, rows: 64 * 180 }],
    },
    manifestRef: ref("jsg/manifest/shared", "quant/jsg-manifest"),
    partitions: [ref("jsg/input/shared")],
  };
  await put(dataset.manifestRef, dataset.manifest);
  await store.put(artifactPath(dataset.partitions[0]!), new Uint8Array([1]));
  const state: ResearchSession = { ...initialSession(), ready: true, dataset };
  const result: JsgResult = {
    equity: [],
    orders: [],
    decisions: [],
    holdings: [],
    warnings: [],
    pendingOrders: 0,
    metrics: {
      engine: "test",
      model: "jsg-adjusted-v1",
      finalEquity: 1e6,
      totalReturn: 0,
      annualizedReturn: 0,
      sharpe: 0,
      maxDrawdown: 0,
      filledOrders: 0,
      rejectedOrders: 0,
      fees: 0,
      days: 156,
    },
  };
  const run = async (id: string, retained: boolean) => {
    const resultRef = ref(`jsg-${id}/result`, "quant/jsg-result");
    const chunkRef = ref(`jsg-${id}/chunk`, "quant/jsg-chunk");
    await put(resultRef, {
      ...result,
      chunks: [{ ref: chunkRef, start: "2024-01-01", end: "2024-12-31", orders: 0 }],
    });
    await put(chunkRef, { equity: [], orders: [], decisions: [] });
    const task = {
      id: `jsg-${id}`,
      runtime: "wasm",
      operation: "quant.backtest.jsg",
      inputs: [dataset.manifestRef, ...dataset.partitions],
      outputs: [],
    } as const;
    await Effect.runPromise(artifacts.registerConsumption(task));
    await Effect.runPromise(artifacts.registerProduction(task.id, [resultRef, chunkRef]));
    caches.push({ key: id, outputs: [resultRef, chunkRef], createdAt: 1, taskIds: [task.id] });
    journal.push({
      task,
      status: "completed",
      createdAt: 1,
      updatedAt: 1,
      attempts: 1,
      outputs: [resultRef, chunkRef],
    });
    const entry: ResearchRun = {
      id,
      config: DEFAULT_CONFIG,
      dataset,
      name: id,
      startDate: dataset.manifest.startDate,
      endDate: dataset.manifest.endDate,
      createdAt: new Date().toISOString(),
      resultRef,
      metrics: result.metrics,
      cached: false,
      durationMs: 1,
    };
    if (retained) state.runs.push(entry);
    return entry;
  };
  return { store, services: { artifacts, scheduler }, state, caches, journal, dataset, put, run };
}
describe("research storage lifecycle", () => {
  it("protects validation and its input snapshot until the study is removed", async () => {
    const s = await setup(),
      run = await s.run("study-source", false);
    const resultRef = ref("jsg/study/kept", "quant/jsg-study-result");
    await s.put(resultRef, { version: 1 });
    const request = {
      mode: "cost" as const,
      objective: "sharpe" as const,
      axes: [],
      trainPercent: 70,
      trainDays: 60,
      testDays: 20,
    };
    s.state.study = {
      run: { ...run, resultRef },
      dataset: s.dataset,
      result: { version: 1, request, training: [], folds: [], costs: [], costBase: DEFAULT_CONFIG },
    };
    const kept = await planResearchCleanup(s.services, s.state, s.store);
    expect(kept.candidates.some((c) => c.id === resultRef.id)).toBe(false);
    s.state.study = null;
    const removed = await planResearchCleanup(s.services, s.state, s.store);
    expect(removed.candidates.some((c) => c.id === resultRef.id)).toBe(true);
  });
  it("retains frozen benchmark files until their run binding is removed", async () => {
    const s = await setup(),
      run = await s.run("with-benchmark", false);
    const ref: ArtifactRef = {
      id: "jsg/benchmark/frozen",
      type: "quant/jsg-benchmark",
      storage: "opfs",
      format: "json",
    };
    await s.put(ref, { version: 1 });
    run.benchmark = { ref, name: "基准", kind: "price", acquiredAt: "2026-10-01T00:00:00Z" };
    s.state.runs = [run];
    const kept = await planResearchCleanup(s.services, s.state, s.store);
    expect(kept.candidates.some((c) => c.id === ref.id)).toBe(false);
    delete run.benchmark;
    const discarded = await planResearchCleanup(s.services, s.state, s.store);
    expect(discarded.candidates.some((c) => c.id === ref.id)).toBe(true);
  });
  it("protects a retained grid and releases its cache and task after it is removed", async () => {
    const s = await setup();
    const run = await s.run("grid", false);
    const resultRef = { ...run.resultRef, type: "quant/jsg-grid-result" };
    s.caches[0] = { ...s.caches[0]!, outputs: [resultRef], taskIds: ["jsg-grid-grid"] };
    s.journal[0] = {
      ...s.journal[0]!,
      task: { ...s.journal[0]!.task, id: "jsg-grid-grid", operation: "quant.grid.jsg" },
    };
    await Effect.runPromise(s.services.artifacts.releaseTask("jsg-grid"));
    await Effect.runPromise(s.services.artifacts.registerConsumption(s.journal[0]!.task));
    await Effect.runPromise(s.services.artifacts.registerProduction("jsg-grid-grid", [resultRef]));
    s.state.dataset = null;
    s.state.grid = {
      run: { ...run, resultRef, axes: [] },
      dataset: s.dataset,
      result: { decodedRows: 1, results: [{ config: DEFAULT_CONFIG, metrics: run.metrics }] },
    };
    const retained = await planResearchCleanup(s.services, s.state, s.store);
    expect(retained.candidates.some((entry) => entry.id === resultRef.id)).toBe(false);
    expect(retained.candidates.some((entry) => entry.id === s.dataset.partitions[0]!.id)).toBe(
      false,
    );
    expect(retained.cache.candidates).toHaveLength(0);
    expect(retained.journal.candidates).toHaveLength(0);
    s.state.grid = null;
    const released = await planResearchCleanup(s.services, s.state, s.store);
    expect(released.cache.candidates).toHaveLength(1);
    expect(released.journal.candidates[0]!.entry.task.operation).toBe("quant.grid.jsg");
  });
  it("reclaims discarded results and lineage while retaining shared market data and other app files", async () => {
    const s = await setup();
    const old = await s.run("old", false);
    const retained = await s.run("retained", true);
    await s.store.put("artifacts/custom/user-data", new Uint8Array([1, 2]));
    const plan = await planResearchCleanup(s.services, s.state, s.store);
    expect(plan.candidates.map((c) => c.id)).toContain(old.resultRef.id);
    const cleaned = await reclaimResearch(s.services, plan, () => s.state, s.store);
    expect(cleaned.deleted).toHaveLength(2);
    expect(await s.store.has(artifactPath(old.resultRef))).toBe(false);
    expect(await s.store.has(artifactPath(retained.resultRef))).toBe(true);
    expect(await s.store.has(artifactPath(s.dataset.partitions[0]!))).toBe(true);
    expect(await s.store.has("artifacts/custom/user-data")).toBe(true);
    expect(s.caches.map((c) => c.key)).toEqual(["retained"]);
  });
  it("rechecks retained references, file sizes and newly created files after a cleanup preview", async () => {
    const s = await setup();
    const old = await s.run("old", false);
    const changed = ref("jsg/input/changed");
    await s.store.put(artifactPath(changed), new Uint8Array([1]));
    const plan = await planResearchCleanup(s.services, s.state, s.store);
    s.state.runs.push(old);
    await s.store.put(artifactPath(changed), new Uint8Array([1, 2]));
    await s.store.put("artifacts/jsg/input/new", new Uint8Array([3]));
    const cleaned = await reclaimResearch(s.services, plan, () => s.state, s.store);
    expect(cleaned.deleted).toHaveLength(0);
    expect(await s.store.has(artifactPath(old.resultRef))).toBe(true);
    expect(await s.store.has("artifacts/jsg/input/new")).toBe(true);
    expect(await s.store.size(artifactPath(changed))).toBe(2);
  });
  it("refuses cleanup if a retained result is unreadable or another task is active", async () => {
    const s = await setup();
    const kept = await s.run("kept", true);
    await s.store.delete(artifactPath(kept.resultRef));
    await expect(planResearchCleanup(s.services, s.state, s.store)).rejects.toThrow();
    s.state.runs = [];
    s.journal[0] = { ...s.journal[0]!, status: "running" };
    await expect(planResearchCleanup(s.services, s.state, s.store)).rejects.toThrow(/运行/u);
  });
  it("lists distinct input contents and removes only abandoned research transfer files during startup", async () => {
    const s = await setup();
    await rememberSnapshot(s.store, s.dataset);
    await rememberSnapshot(s.store, { ...s.dataset, partitions: [ref("jsg/input/other-content")] });
    const usage = await researchUsage(s.services, s.state, s.store);
    expect(usage.snapshots).toHaveLength(2);
    expect(usage.snapshots.filter((v) => v.used)).toHaveLength(1);
    await s.store.put("temp/jsg/abandoned/response.arrow", new Uint8Array([1]));
    await s.store.put("temp/custom/retained", new Uint8Array([2]));
    expect(await recoverResearchFiles(s.store)).toEqual([]);
    expect(await s.store.has("temp/custom/retained")).toBe(true);
    expect(await s.store.has(artifactPath(s.dataset.manifestRef))).toBe(true);
  });
  it("recovers abandoned exports while protecting the download grace period and unrelated files", async () => {
    const store = new MemoryStore();
    const expired = "result-00000000-0000-4000-8000-000000000001.json";
    const recent = "result-00000000-0000-4000-8000-000000000002.json";
    const now = 100_000;
    for (const path of [expired, recent, "retained.json"])
      await store.put(path, new Uint8Array([1]));
    store.getBlob = async (path: string) =>
      new File([new Uint8Array([1])], path, {
        lastModified: path === recent ? now - 59_999 : now - 60_000,
      });
    await recoverResearchExports(store, now);
    expect(await store.has(expired)).toBe(false);
    expect(await store.has(recent)).toBe(true);
    expect(await store.has("retained.json")).toBe(true);
    await recoverResearchExports(store, now + 1);
    expect(await store.has(recent)).toBe(false);
  });
});

it("protects archived experiments even when their grids and studies are not selected", async () => {
  const s = await setup(),
    run = await s.run("archived-source", false);
  const gridRef = ref("jsg/grid/archive", "quant/jsg-grid-result"),
    studyRef = ref("jsg/study/archive", "quant/jsg-study-result");
  await s.put(gridRef, { results: [] });
  await s.put(studyRef, { version: 1 });
  s.state.grids.push({ ...run, id: "old-grid", resultRef: gridRef, axes: [] });
  s.state.studies.push({ ...run, id: "old-study", resultRef: studyRef });
  const plan = await planResearchCleanup(s.services, s.state, s.store);
  expect(
    plan.candidates.some(
      (c) => c.id === gridRef.id || c.id === studyRef.id || c.id === s.dataset.manifestRef.id,
    ),
  ).toBe(false);
  s.state.grids = [];
  s.state.studies = [];
  const released = await planResearchCleanup(s.services, s.state, s.store);
  expect(released.candidates.map((c) => c.id)).toEqual(
    expect.arrayContaining([gridRef.id, studyRef.id]),
  );
});

it("protects all continuous result chunks through the archived study root", async () => {
  const s = await setup(),
    run = await s.run("continuous", false);
  const source = JSON.parse(
    new TextDecoder().decode(await s.store.get(artifactPath(run.resultRef))),
  );
  const studyRef = ref("jsg/study/continuous", "quant/jsg-study-result");
  await s.put(studyRef, { version: 2, continuous: { resultRef: run.resultRef, result: source } });
  s.state.studies = [{ ...run, id: "study", resultRef: studyRef }];
  const kept = await planResearchCleanup(s.services, s.state, s.store);
  const ids = [studyRef.id, run.resultRef.id, source.chunks[0].ref.id];
  expect(kept.candidates.some((c) => ids.includes(c.id))).toBe(false);
  expect(kept.cache.candidates).toHaveLength(0);
  s.state.studies = [];
  const released = await planResearchCleanup(s.services, s.state, s.store);
  expect(released.candidates.map((c) => c.id)).toEqual(expect.arrayContaining(ids));
});
