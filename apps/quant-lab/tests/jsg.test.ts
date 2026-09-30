import { readFileSync } from "node:fs";
import { MemoryStore } from "@bcr/storage-opfs";
import {
  artifactPath,
  artifactStore,
  ArtifactStoreTag,
  contentHash,
  type ComputeTask,
} from "@bcr/core";
import { createArtifactIO } from "@bcr/runtime-worker";
import { RecordBatchStreamWriter, Table, tableFromArrays, tableFromIPC } from "apache-arrow";
import { Context, Effect, Layer } from "effect";
import { beforeAll, describe, expect, it } from "vitest";
import initKernels from "../../../crates/kernels/pkg/bcr_kernels.js";
import initQuant, { JsgBacktest } from "../../../crates/quant/pkg/bcr_quant.js";
import { jsgHandler, type BacktestSession } from "../src/jsg/compute";
import { importResearch } from "../src/jsg/data";
import { demoResearch } from "../src/jsg/demo";
import {
  DEFAULT_CONFIG,
  MAX_PARTITION_BYTES,
  parseManifest,
  validateConfig,
  type JsgResult,
} from "../src/jsg/model";

beforeAll(async () => {
  await initKernels({
    module_or_path: readFileSync(
      new URL("../../../crates/kernels/pkg/bcr_kernels_bg.wasm", import.meta.url),
    ),
  });
  await initQuant({
    module_or_path: readFileSync(
      new URL("../../../crates/quant/pkg/bcr_quant_bg.wasm", import.meta.url),
    ),
  });
});

async function execute(repartition: boolean): Promise<JsgResult> {
  const demo = demoResearch();
  const engine = new JsgBacktest(JSON.stringify(demo.manifest), JSON.stringify(DEFAULT_CONFIG));
  try {
    for (const file of demo.files.slice(1)) {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const batches = repartition
        ? tableFromIPC(bytes).batches.map((batch) =>
            RecordBatchStreamWriter.writeAll(new Table([batch])).toUint8Array(true),
          )
        : [bytes];
      for (const b of batches) {
        engine.load_partition(b);
        while (engine.advance()) {
          /* retain state across stream boundaries */
        }
      }
    }
    return JSON.parse(engine.finish()) as JsgResult;
  } finally {
    engine.free();
  }
}

describe("JSG Rust + Arrow research boundary", () => {
  it("produces identical complete results with 20-day and single-day Arrow partitions", async () => {
    const normal = await execute(false);
    const daily = await execute(true);
    expect(daily).toEqual(normal);
    expect(normal.metrics.days).toBe(156);
    expect(normal.metrics.model).toBe("jsg-adjusted-v1");
    expect(normal.metrics.filledOrders).toBeGreaterThan(20);
    expect(normal.equity.every((row) => row.cash >= 0)).toBe(true);
    expect(normal.orders.every((o) => o.quantity % 100 === 0)).toBe(true);
  });
  it("rejects incomplete streams, duplicate sessions and extra days", async () => {
    const demo = demoResearch();
    const e = new JsgBacktest(JSON.stringify(demo.manifest), JSON.stringify(DEFAULT_CONFIG));
    const file = demo.files[1];
    if (file === undefined) throw new Error("fixture missing");
    const bytes = new Uint8Array(await file.arrayBuffer());
    e.load_partition(bytes);
    expect(() => e.load_partition(bytes)).toThrow();
    while (e.advance()) {
      /* exhaust the first bounded partition */
    }
    expect(() => e.finish()).toThrow();
    e.free();
    const duplicate = new JsgBacktest(
      JSON.stringify(demo.manifest),
      JSON.stringify(DEFAULT_CONFIG),
    );
    duplicate.load_partition(bytes);
    while (duplicate.advance()) {
      /* first stream */
    }
    duplicate.load_partition(bytes);
    expect(() => duplicate.advance()).toThrow();
    duplicate.free();
  });
  it("fails on Arrow schema mismatches instead of silently falling back to another engine", () => {
    const demo = demoResearch();
    const e = new JsgBacktest(JSON.stringify(demo.manifest), JSON.stringify(DEFAULT_CONFIG));
    e.load_partition(
      RecordBatchStreamWriter.writeAll(
        tableFromArrays({ date: new Uint32Array([20240102]) }),
      ).toUint8Array(true),
    );
    expect(() => e.advance()).toThrow();
    e.free();
  });
  it("validates portable manifests and rejects oversized partitions or invalid dates", () => {
    const { manifest } = demoResearch();
    expect(parseManifest(manifest)).toEqual(manifest);
    expect(() => parseManifest({ ...manifest, industries: ["tech", "tech"] })).toThrow();
    expect(() =>
      parseManifest({ ...manifest, partitions: [{ file: "../escape.arrow", bytes: 2, rows: 2 }] }),
    ).toThrow();
    expect(() =>
      parseManifest({
        ...manifest,
        partitions: [{ file: "large.arrow", bytes: MAX_PARTITION_BYTES + 1, rows: 2 }],
      }),
    ).toThrow();
    expect(() =>
      parseManifest({ ...manifest, calendar: [{ date: 20240230, rebalance: true }] }),
    ).toThrow();
    expect(() => validateConfig({ ...DEFAULT_CONFIG, stockCount: 21 })).toThrow();
  });
  it("imports with stream writes and deduplicates by actual partition content", async () => {
    const store = new MemoryStore();
    const context = await Effect.runPromise(
      Effect.scoped(Layer.build(artifactStore({ opfs: store }))),
    );
    const artifacts = Context.get(context, ArtifactStoreTag);
    const services = { artifacts };
    const { files } = demoResearch();
    const imported = await importResearch(services, files, () => undefined);
    expect(imported.partitions).toHaveLength(9);
    const firstFile = files[1];
    if (firstFile === undefined) throw new Error("fixture missing");
    expect(imported.partitions[0]?.hash).toBe(
      contentHash(new Uint8Array(await firstFile.arrayBuffer())),
    );
    const total = (await Effect.runPromise(artifacts.inventory())).length;
    await importResearch(services, files, () => undefined);
    expect((await Effect.runPromise(artifacts.inventory())).length).toBe(total);
    await expect(importResearch(services, files.slice(0, -1), () => undefined)).rejects.toThrow();
    expect((await Effect.runPromise(artifacts.inventory())).length).toBe(total);
  });
  it("worker cancellation frees Rust state and never loads later partitions or publishes a result", async () => {
    const store = new MemoryStore();
    const io = createArtifactIO(store, "opfs");
    const demo = demoResearch();
    const bytes = new TextEncoder().encode(JSON.stringify(demo.manifest));
    const hash = contentHash(bytes);
    const ref = {
      id: hash,
      hash,
      type: "quant/jsg-manifest",
      storage: "opfs" as const,
      port: "manifest",
    };
    await store.put(artifactPath(ref), bytes);
    for (const [i, file] of demo.files.slice(1).entries())
      await store.put(`artifacts/p-${i}`, new Uint8Array(await file.arrayBuffer()));
    const task: ComputeTask = {
      id: "cancel-test",
      runtime: "wasm",
      operation: "quant.backtest.jsg",
      inputs: [
        ref,
        ...demo.manifest.partitions.map((_, i) => ({
          id: `p-${i}`,
          type: "quant/jsg-daily",
          storage: "opfs" as const,
          port: `partition-${i}`,
        })),
      ],
      outputs: [],
      config: { strategy: DEFAULT_CONFIG },
    };
    const abort = new AbortController();
    let loaded = 0;
    let freed = false;
    let finished = false;
    const engine: BacktestSession = {
      load_partition: () => {
        loaded++;
      },
      advance: () => true,
      processed_days: () => 1,
      processed_rows: () => 64,
      finish: () => {
        finished = true;
        return "{}";
      },
      free: () => {
        freed = true;
      },
    };
    await expect(
      jsgHandler(io, async () => engine)(task, {
        signal: abort.signal,
        progress: () => abort.abort(),
        emitChunk: () => undefined,
      }),
    ).rejects.toThrow("cancelled");
    expect(loaded).toBe(1);
    expect(freed).toBe(true);
    expect(finished).toBe(false);
    expect((await store.list("artifacts/jsg/result")).length).toBe(0);
  });
});

it("streams every Rust event into bounded artifacts while keeping a small UI preview", async () => {
  const store = new MemoryStore();
  const layer = await Effect.runPromise(Effect.scoped(Layer.build(artifactStore({ opfs: store }))));
  const dataset = await importResearch(
    { artifacts: Context.get(layer, ArtifactStoreTag) },
    demoResearch().files,
    () => undefined,
  );
  const io = createArtifactIO(store, "opfs");
  const ctx = {
    signal: new AbortController().signal,
    progress: () => undefined,
    emitChunk: () => undefined,
  };
  const outputs = await jsgHandler(io)(
    {
      id: "stream-test",
      runtime: "wasm",
      operation: "quant.backtest.jsg",
      outputs: [],
      inputs: [
        { ...dataset.manifestRef, port: "manifest" },
        ...dataset.partitions.map((p, i) => ({ ...p, port: `partition-${i}` })),
      ],
      config: { strategy: DEFAULT_CONFIG },
    },
    ctx,
  );
  const summaryRef = outputs.find((r) => r.type === "quant/jsg-result")!;
  const summary = await io.readJsonArtifact<JsgResult>(summaryRef, ctx);
  expect(summary.orders.length).toBeLessThanOrEqual(200);
  expect(summary.decisions.length).toBeLessThanOrEqual(1);
  const chunks = await Promise.all(
    summary.chunks!.map((c) =>
      io.readJsonArtifact<Pick<JsgResult, "equity" | "orders" | "decisions">>(c.ref, ctx),
    ),
  );
  const full = await execute(false);
  expect(chunks.flatMap((c) => c.orders)).toEqual(full.orders);
  expect(chunks.flatMap((c) => c.equity)).toEqual(full.equity);
  expect(chunks.flatMap((c) => c.decisions)).toEqual(full.decisions);
  expect(summary.metrics).toEqual(full.metrics);
});

it("removes result chunks when cancellation arrives after the first persisted chunk", async () => {
  const store = new MemoryStore();
  const io = createArtifactIO(store, "opfs");
  const demo = demoResearch();
  const layer = await Effect.runPromise(Effect.scoped(Layer.build(artifactStore({ opfs: store }))));
  const dataset = await importResearch(
    { artifacts: Context.get(layer, ArtifactStoreTag) },
    demo.files,
    () => undefined,
  );
  const abort = new AbortController();
  let days = 0,
    freed = false;
  const engine: BacktestSession = {
    enable_streaming: () => undefined,
    load_partition: () => undefined,
    advance: () => {
      days++;
      if (days === 6) abort.abort();
      return true;
    },
    processed_days: () => days,
    processed_rows: () => days * 64,
    drain_output: () =>
      JSON.stringify({
        equity: [{ date: "2024-01-01", equity: 1, cash: 1, drawdown: 0, holdings: 0 }],
        orders: [],
        decisions: [],
      }),
    finish: () => {
      throw new Error("must not finish");
    },
    free: () => {
      freed = true;
    },
  };
  await expect(
    jsgHandler(io, async () => engine)(
      {
        id: "cancel-stream",
        runtime: "wasm",
        operation: "quant.backtest.jsg",
        outputs: [],
        inputs: [
          { ...dataset.manifestRef, port: "manifest" },
          ...dataset.partitions.map((p, i) => ({ ...p, port: `partition-${i}` })),
        ],
        config: { strategy: DEFAULT_CONFIG },
      },
      { signal: abort.signal, progress: () => undefined, emitChunk: () => undefined },
    ),
  ).rejects.toThrow("cancelled");
  expect(freed).toBe(true);
  expect((await store.list("artifacts/jsg-")).length).toBe(0);
});
