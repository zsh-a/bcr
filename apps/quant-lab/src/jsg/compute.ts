import { artifactPath, type ArtifactRef, type ComputeTask } from "@bcr/core";
import { throwIfAborted, type ArtifactIO, type WorkerContext } from "@bcr/runtime-worker";
import initQuant, { JsgBacktest } from "../../../../crates/quant/pkg/bcr_quant.js";
import {
  MAX_PARTITION_BYTES,
  parseManifest,
  validateConfig,
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
    const outputNamespace = `jsg-${crypto.randomUUID()}`;
    const created: ArtifactRef[] = [];
    let published = false;
    try {
      const streamed = engine.enable_streaming !== undefined && engine.drain_output !== undefined;
      if (streamed) engine.enable_streaming!();
      const chunks: NonNullable<JsgResult["chunks"]> = [];
      let preview: Pick<JsgResult, "equity" | "orders" | "decisions"> = {
        equity: [],
        orders: [],
        decisions: [],
      };
      let lastDrain = 0;
      const drain = async () => {
        if (!streamed) return;
        const chunk = JSON.parse(engine.drain_output!()) as Pick<
          JsgResult,
          "equity" | "orders" | "decisions"
        >;
        lastDrain = engine.processed_days();
        if (chunk.equity.length === 0 && chunk.orders.length === 0 && chunk.decisions.length === 0)
          return;
        const ref = await io.writeTypedJsonArtifact(
          outputNamespace,
          `chunk-${chunks.length}`,
          "quant/jsg-chunk",
          chunk,
        );
        created.push(ref);
        chunks.push({
          ref,
          start: chunk.equity[0]?.date ?? "",
          end: chunk.equity.at(-1)?.date ?? "",
          orders: chunk.orders.length,
        });
        preview.equity.push(...chunk.equity);
        while (preview.equity.length > 2048)
          preview.equity = preview.equity.filter(
            (_, i) => i % 2 === 0 || i === preview.equity.length - 1,
          );
        preview.orders = preview.orders.concat(chunk.orders).slice(-200);
        preview.decisions = preview.decisions.concat(chunk.decisions).slice(-1);
      };
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
          if (streamed && engine.processed_days() - lastDrain >= 5) await drain();
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
      await drain();
      const result = JSON.parse(engine.finish()) as JsgResult;
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
