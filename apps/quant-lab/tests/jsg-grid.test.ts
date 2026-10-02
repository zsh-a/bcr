import {
  artifactPath,
  artifactStore,
  ArtifactStoreTag,
  contentHash,
  type ArtifactRef,
} from "@bcr/core";
import { DEFAULT_CONFIG, type JsgResult } from "@bcr/quant-core";
import { createArtifactIO } from "@bcr/runtime-worker";
import { MemoryStore } from "@bcr/storage-opfs";
import { RecordBatchStreamWriter, Table, tableFromArrays, tableFromIPC } from "apache-arrow";
import { Context, Effect, Layer } from "effect";
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import initQuant, { JsgBacktest, JsgGrid } from "../../../crates/quant/pkg/bcr_quant.js";
import { demoResearch } from "../src/data/demo";
import { jsgGridHandler } from "../src/execution/grid-compute";
import { gridConfigs, rankGrid, type GridResult } from "../src/experiments/grid";
import { canonicalConfig } from "../src/session/config";
import { type ResearchSession, type SelectedGrid } from "../src/session/model";
import { restoreSession, saveSession } from "../src/session/persistence";
import { initialSession, sessionReducer } from "../src/session/reducer";

beforeAll(async () => {
  await initQuant({
    module_or_path: readFileSync(
      new URL("../../../crates/quant/pkg/bcr_quant_bg.wasm", import.meta.url),
    ),
  });
});
const configs = () =>
  gridConfigs(DEFAULT_CONFIG, [
    { field: "stockCount", values: "1, 5, 10" },
    { field: "stopLoss", values: "0, 4" },
    { field: "maxDrawdown", values: "0, 20" },
  ]);
async function replay(engine: JsgBacktest | JsgGrid, files = demoResearch().files) {
  for (const file of files.slice(1)) {
    engine.load_partition(new Uint8Array(await file.arrayBuffer()));
    while (engine.advance()) {
      /* cooperative advance tested in worker below */
    }
  }
  return JSON.parse(engine.finish());
}
async function input() {
  const store = new MemoryStore(),
    demo = demoResearch();
  const ref = (file: File, bytes: Uint8Array): ArtifactRef => ({
    id: `jsg/input/${file.name}/${contentHash(bytes)}`,
    type: file.name.endsWith("json") ? "quant/jsg-manifest" : "quant/jsg-daily",
    storage: "opfs",
    hash: contentHash(bytes),
    format: file.name.endsWith("json") ? "json" : "arrow-ipc",
  });
  const refs = [];
  for (const file of demo.files) {
    const bytes = new Uint8Array(await file.arrayBuffer()),
      target = ref(file, bytes);
    refs.push(target);
    await store.put(artifactPath(target), bytes);
  }
  const dataset = { manifest: demo.manifest, manifestRef: refs[0]!, partitions: refs.slice(1) };
  const task = {
    id: "jsg-grid-test",
    operation: "quant.grid.jsg",
    runtime: "wasm" as const,
    inputs: [
      { ...refs[0]!, port: "manifest" },
      ...refs.slice(1).map((ref, i) => ({ ...ref, port: `partition-${i}` })),
    ],
    outputs: [],
    config: { strategies: configs() },
  };
  const context = {
    signal: new AbortController().signal,
    progress: () => undefined,
    emitChunk: () => undefined,
  };
  return { store, dataset, task, context, io: createArtifactIO(store, "opfs") };
}
describe("JSG browser parameter grid", () => {
  it("expands deterministic unique combinations and validates the entire Cartesian product", () => {
    const result = gridConfigs(DEFAULT_CONFIG, [
      { field: "stockCount", values: "5，05, 10" },
      { field: "stopLoss", values: "0; 5" },
    ]);
    expect(result.map((row) => [row.stockCount, row.stopLoss])).toEqual([
      [5, 0],
      [5, 0.05],
      [10, 0],
      [10, 0.05],
    ]);
    expect(() => gridConfigs(DEFAULT_CONFIG, [{ field: "stockCount", values: "" }])).toThrow();
    expect(() => gridConfigs(DEFAULT_CONFIG, [{ field: "stockCount", values: "1e3" }])).toThrow();
    expect(() =>
      gridConfigs(DEFAULT_CONFIG, [
        { field: "stockCount", values: "5" },
        { field: "stockCount", values: "10" },
      ]),
    ).toThrow(/重复/u);
    expect(() => gridConfigs(DEFAULT_CONFIG, [{ field: "poolSize", values: "5, 20" }])).toThrow();
    expect(() =>
      gridConfigs(DEFAULT_CONFIG, [
        { field: "stockCount", values: "1,2,3,4,5,6,7,8,9" },
        { field: "slippageBps", values: "1,2,3,4,5,6,7,8" },
      ]),
    ).toThrow(/64/u);
    expect(DEFAULT_CONFIG.stockCount).toBe(10);
    expect(canonicalConfig(DEFAULT_CONFIG)).toEqual(
      canonicalConfig({
        ...DEFAULT_CONFIG,
        executionModel: "jsg-adjusted-v1",
        participation: 0.1,
        fees: [],
      }),
    );
  });
  it("shares daily features but preserves independent portfolio metrics across all 12 combinations", async () => {
    const demo = demoResearch(),
      strategies = configs();
    const engine = new JsgGrid(JSON.stringify(demo.manifest), JSON.stringify(strategies));
    let actual: GridResult;
    try {
      actual = await replay(engine, demo.files);
    } finally {
      engine.free();
    }
    expect(actual.decodedRows).toBe(64 * 180);
    for (const [index, config] of strategies.entries()) {
      const independent = new JsgBacktest(JSON.stringify(demo.manifest), JSON.stringify(config));
      try {
        const result = (await replay(independent, demo.files)) as JsgResult;
        expect(actual.results[index]!.metrics).toEqual(result.metrics);
      } finally {
        independent.free();
      }
    }
    const ranked = rankGrid(actual, "maxDrawdown", true);
    expect(ranked.map((row) => row.metrics.maxDrawdown)).toEqual(
      ranked.map((row) => row.metrics.maxDrawdown).sort((a, b) => b - a),
    );
    expect(() => new JsgGrid(JSON.stringify(demo.manifest), "[]")).toThrow();
    expect(
      () =>
        new JsgGrid(JSON.stringify(demo.manifest), JSON.stringify(Array(65).fill(DEFAULT_CONFIG))),
    ).toThrow();
  });
  it("reads each partition once and publishes only a bounded metrics artifact", async () => {
    const s = await input();
    let reads = 0;
    const io = {
      ...s.io,
      getBlob: async (ref: ArtifactRef) => {
        reads++;
        return s.io.getBlob(ref);
      },
    };
    const outputs = await jsgGridHandler(io)(s.task, s.context);
    expect(reads).toBe(s.dataset.partitions.length);
    expect(outputs).toHaveLength(1);
    const result = await s.io.readJsonArtifact<GridResult>(outputs[0]!, s.context);
    expect(result.decodedRows).toBe(64 * 180);
    expect(result.results).toHaveLength(12);
    expect(await s.store.size(artifactPath(outputs[0]!))).toBeLessThan(100_000);
  });
  it("matches independent raw-v2 accounts with partial fills, dated fees and corporate actions", async () => {
    const demo = demoResearch();
    const manifest = {
      ...demo.manifest,
      version: 2,
      schema: "jsg-daily-v2",
      dataQuality: {
        membership: "snapshot",
        financials: "latest",
        corporateActions: "complete",
        priceLimits: "daily",
      },
      corporateActions: [
        {
          id: 2,
          knownDate: demo.manifest.calendar[33]!.date,
          recordDate: demo.manifest.calendar[34]!.date,
          exDate: demo.manifest.calendar[35]!.date,
          payDate: demo.manifest.calendar[40]!.date,
          shareAvailableDate: demo.manifest.calendar[40]!.date,
          cashPerShare: 0.1,
          withholdingPerShare: 0.01,
          shareRatio: 0.1,
          fractionalCashPrice: 10,
        },
      ],
    };
    const files = [demo.files[0]!];
    for (const file of demo.files.slice(1)) {
      const table = tableFromIPC(new Uint8Array(await file.arrayBuffer()));
      const batches = table.batches.flatMap((batch) => {
        const day = new Table([batch]);
        return tableFromArrays({
          ...Object.fromEntries(
            day.schema.fields.map((field) => [field.name, day.getChild(field.name)!]),
          ),
          volume: new BigUint64Array(day.numRows).fill(5000n),
          limit_up: new Float64Array(day.numRows),
          limit_down: new Float64Array(day.numRows),
        }).batches;
      });
      files.push(
        new File(
          [
            RecordBatchStreamWriter.writeAll(new Table(batches)).toUint8Array(
              true,
            ) as Uint8Array<ArrayBuffer>,
          ],
          file.name,
        ),
      );
    }
    const strategies = gridConfigs(
      {
        ...DEFAULT_CONFIG,
        executionModel: "jsg-raw-v2",
        participation: 0.1,
        fees: [{ from: 20100101, minimumCommission: 5, transferBps: 0.1, sellTaxBps: 5 }],
      },
      [
        { field: "stockCount", values: "2,6" },
        { field: "stopLoss", values: "0,5" },
      ],
    );
    const shared = new JsgGrid(JSON.stringify(manifest), JSON.stringify(strategies));
    let actual: GridResult;
    try {
      actual = await replay(shared, files);
    } finally {
      shared.free();
    }
    for (const [index, config] of strategies.entries()) {
      const engine = new JsgBacktest(JSON.stringify(manifest), JSON.stringify(config));
      try {
        expect(actual.results[index]!.metrics).toEqual((await replay(engine, files)).metrics);
      } finally {
        engine.free();
      }
    }
  });
  it("cancels between portfolios without publishing or retaining a partial output", async () => {
    const s = await input(),
      abort = new AbortController();
    let freed = false,
      advances = 0;
    await expect(
      jsgGridHandler(s.io, async () => ({
        load_partition: () => undefined,
        advance: () => {
          advances++;
          abort.abort();
          return true;
        },
        processed_days: () => 0,
        processed_rows: () => 0,
        finish: () => "{}",
        free: () => {
          freed = true;
        },
      }))(s.task, { ...s.context, signal: abort.signal }),
    ).rejects.toThrow();
    expect(advances).toBe(1);
    expect(freed).toBe(true);
    expect(
      (await s.store.list("artifacts/")).filter((path) => path.startsWith("artifacts/jsg-grid-")),
    ).toEqual([]);
  });
  it("removes a completed metrics file when cancellation arrives during publication", async () => {
    const s = await input(),
      abort = new AbortController();
    const io = {
      ...s.io,
      writeTypedJsonArtifact: async (...args: Parameters<typeof s.io.writeTypedJsonArtifact>) => {
        const ref = await s.io.writeTypedJsonArtifact(...args);
        abort.abort();
        return ref;
      },
    };
    await expect(
      jsgGridHandler(io)(s.task, { ...s.context, signal: abort.signal }),
    ).rejects.toThrow();
    expect(
      (await s.store.list("artifacts/")).filter((path) => path.startsWith("artifacts/jsg-grid-")),
    ).toEqual([]);
  });
  it("restores a grid on its frozen input and retains it through cancellation and stale completion", async () => {
    const s = await input(),
      [resultRef] = await jsgGridHandler(s.io)(s.task, s.context);
    const result = await s.io.readJsonArtifact<GridResult>(resultRef!, s.context);
    const grid: SelectedGrid = {
      dataset: s.dataset,
      result,
      run: {
        id: "first",
        createdAt: "2026-10-01T00:00:00Z",
        axes: [{ field: "stockCount", values: "1,5,10" }],
        name: s.dataset.manifest.name,
        startDate: s.dataset.manifest.startDate,
        endDate: s.dataset.manifest.endDate,
        dataset: s.dataset,
        resultRef: resultRef!,
        cached: false,
        durationMs: 10,
      },
    };
    let state: ResearchSession = { ...initialSession(), dataset: s.dataset, ready: true, grid };
    state = sessionReducer(state, {
      type: "started",
      operation: { id: "next", kind: "grid", label: "run", progress: 0 },
    });
    expect(sessionReducer(state, { type: "grid-finished", id: "stale", grid }).operation?.id).toBe(
      "next",
    );
    state = sessionReducer(state, { type: "stopped", id: "next" });
    expect(state.grid).toEqual(grid);
    const records = new Map<string, string>();
    const artifactContext = await Effect.runPromise(
      Effect.scoped(Layer.build(artifactStore({ opfs: s.store }))),
    );
    const services = {
      artifacts: Context.get(artifactContext, ArtifactStoreTag),
      metadata: {
        get: async (key: string) => records.get(key),
        set: async (key: string, value: string) => {
          records.set(key, value);
        },
      },
    };
    await saveSession(services, state);
    const restored = await restoreSession(services);
    expect(restored?.grid?.result).toEqual(result);
    expect(restored?.grid?.dataset.manifestRef).toEqual(s.dataset.manifestRef);
    expect(restored?.selected).toBe(null);
    expect(sessionReducer(state, { type: "forget-grid" }).grid).toBe(null);
  });
});
