import type { ArtifactRef, ComputeTask } from "@bcr/core";
import { throwIfAborted, type ArtifactIO, type WorkerContext } from "@bcr/runtime-worker";
import initQuant, { JsgBacktest } from "../../../../crates/quant/pkg/bcr_quant.js";
import { MAX_PARTITION_BYTES, parseManifest, validateConfig, type JsgConfig } from "./model";

export interface BacktestSession {
  load_partition(bytes: Uint8Array): void;
  advance(): boolean;
  processed_days(): number;
  processed_rows(): number;
  finish(): string;
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
    const manifestRef = task.inputs.find((ref) => ref.port === "manifest");
    if (manifestRef === undefined) throw new Error("JSG requires a research manifest");
    const manifest = parseManifest(await io.readJsonArtifact<unknown>(manifestRef, ctx));
    const config = task.config?.["strategy"] as JsgConfig;
    if (config === undefined) throw new Error("JSG strategy config missing");
    validateConfig(config);
    throwIfAborted(ctx);
    const engine = await factory(JSON.stringify(manifest), JSON.stringify(config));
    try {
      let yieldedAt = performance.now() - 16;
      for (const [index, partition] of manifest.partitions.entries()) {
        throwIfAborted(ctx);
        const ref = task.inputs.find((input) => input.port === `partition-${index}`);
        if (ref === undefined) throw new Error(`missing Arrow partition ${partition.file}`);
        const blob = await io.getBlob(ref);
        if (blob.size !== partition.bytes || blob.size > MAX_PARTITION_BYTES)
          throw new Error(`invalid Arrow partition size: ${partition.file}`);
        engine.load_partition(new Uint8Array(await blob.arrayBuffer()));
        const previousRows = engine.processed_rows();
        while (engine.advance()) {
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
      }
      throwIfAborted(ctx);
      const result: unknown = JSON.parse(engine.finish());
      const ref = await io.writeTypedJsonArtifact("jsg", "result", "quant/jsg-result", result);
      throwIfAborted(ctx);
      ctx.progress(1);
      return [ref];
    } finally {
      engine.free();
    }
  };
}
