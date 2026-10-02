import { artifactPath, type ArtifactRef, type ComputeTask } from "@bcr/core";
import { throwIfAborted, type ArtifactIO, type WorkerContext } from "@bcr/runtime-worker";
import initQuant, { JsgBacktest } from "../../../../crates/quant/pkg/bcr_quant.js";
import {
  MAX_PARTITION_BYTES,
  parseManifest,
  validateConfig,
  validateParameterSchedule,
  type ParameterStep,
  type JsgConfig,
  type JsgResult,
} from "./model";

export interface BacktestSession {
  load_partition(bytes: Uint8Array): void;
  advance(): boolean;
  processed_days(): number;
  processed_rows(): number;
  finish(): string;
  enable_streaming?(): void;
  drain_output?(): string;
  set_schedule?(json: string): void;
  free(): void;
}
type Factory = (manifest: string, config: string) => Promise<BacktestSession>;
let ready: Promise<unknown> | undefined;
async function createSession(manifest: string, config: string): Promise<BacktestSession> {
  ready ??= initQuant();
  await ready;
  return new JsgBacktest(manifest, config);
}
/** One Rust instance survives every partition; yields between daily batches for cancellation. */
export function jsgHandler(io: ArtifactIO, factory: Factory = createSession) {
  return async (task: ComputeTask, ctx: WorkerContext): Promise<readonly ArtifactRef[]> => {
    const began = performance.now();
    const timings = { totalMs: 0, readMs: 0, computeMs: 0, writeMs: 0, rows: 0, partitions: 0 };
    const manifestRef = task.inputs.find((ref) => ref.port === "manifest");
    if (manifestRef === undefined) throw new Error("JSG requires a research manifest");
    const manifest = parseManifest(await io.readJsonArtifact<unknown>(manifestRef, ctx));
    const config = task.config?.["strategy"] as JsgConfig;
    if (config === undefined) throw new Error("JSG strategy config missing");
    validateConfig(config);
    const schedule = task.config?.["schedule"] as ParameterStep[] | undefined;
    if (schedule !== undefined) validateParameterSchedule(manifest, config, schedule);
    throwIfAborted(ctx);
    const engine = await factory(JSON.stringify(manifest), JSON.stringify(config));
    const outputNamespace = `jsg-${crypto.randomUUID()}`;
    const created: ArtifactRef[] = [];
    let published = false;
    try {
      if (schedule !== undefined) {
        if (!engine.set_schedule) throw new Error("回测引擎不支持连续参数回放");
        engine.set_schedule(JSON.stringify(schedule));
      }
      const streamed = engine.enable_streaming !== undefined && engine.drain_output !== undefined;
      if (streamed) engine.enable_streaming!();
      const chunks: NonNullable<JsgResult["chunks"]> = [];
      let preview: Pick<JsgResult, "equity" | "orders" | "decisions"> = {
        equity: [],
        orders: [],
        decisions: [],
      };
      let lastDrain = 0;
      let buffered: Pick<JsgResult, "equity" | "orders" | "decisions" | "research"> = {
        equity: [],
        orders: [],
        decisions: [],
        research: [],
      };
      let bufferedBytes = 0;
      const flush = async () => {
        const chunk = buffered;
        if (!chunk.equity.length && !chunk.orders.length && !chunk.decisions.length) return;
        buffered = { equity: [], orders: [], decisions: [], research: [] };
        bufferedBytes = 0;
        if (new TextEncoder().encode(JSON.stringify(chunk)).byteLength > MAX_PARTITION_BYTES)
          throw new Error("单日研究结果超过 32 MiB，请减少目标股票数或数据宇宙");
        const writeStart = performance.now();
        const ref = await io.writeTypedJsonArtifact(
          outputNamespace,
          `chunk-${chunks.length}`,
          "quant/jsg-chunk",
          chunk,
        );
        timings.writeMs += performance.now() - writeStart;
        created.push(ref);
        const codes = [...new Set(chunk.orders.map((o) => o.code))];
        const orderStats = new Map<
          string,
          { side: string; status: string; filled: boolean; count: number }
        >();
        for (const order of chunk.orders) {
          const key = JSON.stringify([order.side, order.status, order.quantity > 0]);
          const cell = orderStats.get(key) ?? {
            side: order.side,
            status: order.status,
            filled: order.quantity > 0,
            count: 0,
          };
          cell.count++;
          orderStats.set(key, cell);
        }
        chunks.push({
          ref,
          start: chunk.equity[0]?.date ?? "",
          end: chunk.equity.at(-1)?.date ?? "",
          orders: chunk.orders.length,
          ...(codes.length <= 256 ? { codes } : {}),
          orderStats: [...orderStats.values()],
        });
        preview.equity.push(...chunk.equity);
        while (preview.equity.length > 2048)
          preview.equity = preview.equity.filter(
            (_, i) => i % 2 === 0 || i === preview.equity.length - 1,
          );
        preview.orders = preview.orders.concat(chunk.orders).slice(-200);
        preview.decisions = preview.decisions.concat(chunk.decisions).slice(-1);
      };
      const drain = async (final = false) => {
        if (!streamed) return;
        const computeStart = performance.now();
        const json = engine.drain_output!();
        const chunk = JSON.parse(json) as typeof buffered;
        const bytes = new TextEncoder().encode(json).byteLength;
        timings.computeMs += performance.now() - computeStart;
        lastDrain = engine.processed_days();
        if (bufferedBytes + bytes > 8 * 1024 * 1024) await flush();
        buffered.equity.push(...chunk.equity);
        buffered.orders.push(...chunk.orders);
        buffered.decisions.push(...chunk.decisions);
        buffered.research!.push(...(chunk.research ?? []));
        bufferedBytes += bytes;
        if (final || buffered.equity.length >= 5 || bufferedBytes >= 8 * 1024 * 1024) await flush();
      };
      let yieldedAt = performance.now() - 16;
      for (const [index, partition] of manifest.partitions.entries()) {
        throwIfAborted(ctx);
        const ref = task.inputs.find((input) => input.port === `partition-${index}`);
        if (ref === undefined) throw new Error(`missing Arrow partition ${partition.file}`);
        const readStart = performance.now();
        const blob = await io.getBlob(ref);
        if (blob.size !== partition.bytes || blob.size > MAX_PARTITION_BYTES)
          throw new Error(`invalid Arrow partition size: ${partition.file}`);
        const bytes = new Uint8Array(await blob.arrayBuffer());
        timings.readMs += performance.now() - readStart;
        const decodeStart = performance.now();
        engine.load_partition(bytes);
        timings.computeMs += performance.now() - decodeStart;
        const previousRows = engine.processed_rows();
        for (;;) {
          const computeStart = performance.now();
          const advanced = engine.advance();
          timings.computeMs += performance.now() - computeStart;
          if (!advanced) break;
          if (streamed && engine.processed_days() > lastDrain) await drain();
          // Keep cancellation responsive without paying a timer for every small day.
          if (performance.now() - yieldedAt >= 16) {
            ctx.progress(
              Math.min(0.95, (engine.processed_days() / manifest.calendar.length) * 0.95),
            );
            await new Promise<void>((resolve) => setTimeout(resolve, 0));
            yieldedAt = performance.now();
          }
          throwIfAborted(ctx);
        }
        if (engine.processed_rows() - previousRows !== partition.rows)
          throw new Error(`Arrow row count mismatch: ${partition.file}`);
        timings.rows += partition.rows;
        timings.partitions++;
      }
      throwIfAborted(ctx);
      await drain(true);
      const finishStart = performance.now();
      const result = JSON.parse(engine.finish()) as JsgResult;
      timings.computeMs += performance.now() - finishStart;
      timings.totalMs = performance.now() - began;
      result.timings = timings;
      if (streamed) Object.assign(result, preview, { chunks });
      const ref = await io.writeTypedJsonArtifact(
        outputNamespace,
        "result",
        "quant/jsg-result",
        result,
      );
      created.push(ref);
      throwIfAborted(ctx);
      published = true;
      ctx.progress(1);
      return [ref, ...chunks.map((c) => c.ref)];
    } finally {
      engine.free();
      if (!published)
        await Promise.allSettled(created.map((ref) => io.store.delete(artifactPath(ref))));
    }
  };
}
