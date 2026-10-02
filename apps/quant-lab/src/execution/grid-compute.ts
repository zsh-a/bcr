import { artifactPath, type ArtifactRef, type ComputeTask } from "@bcr/core";
import { MAX_PARTITION_BYTES, parseManifest } from "@bcr/market-data/research/model";
import { type JsgConfig } from "@bcr/quant-core";
import { throwIfAborted, type ArtifactIO, type WorkerContext } from "@bcr/runtime-worker";
import initQuant, { JsgGrid } from "../../../../crates/quant/pkg/bcr_quant.js";
import { validateGrid, type GridResult } from "../experiments/grid";
import type { BacktestSession } from "./compute";

let ready: Promise<unknown> | undefined;
const create = async (manifest: string, configs: string): Promise<BacktestSession> => {
  ready ??= initQuant();
  await ready;
  return new JsgGrid(manifest, configs);
};
export function jsgGridHandler(io: ArtifactIO, factory = create) {
  return async (task: ComputeTask, ctx: WorkerContext): Promise<readonly ArtifactRef[]> => {
    const began = performance.now();
    const manifestRef = task.inputs.find((ref) => ref.port === "manifest");
    if (!manifestRef) throw new Error("参数实验缺少行情清单");
    const manifest = parseManifest(await io.readJsonArtifact<unknown>(manifestRef, ctx));
    const configs = task.config?.["strategies"] as JsgConfig[];
    validateGrid(configs);
    throwIfAborted(ctx);
    const engine = await factory(JSON.stringify(manifest), JSON.stringify(configs));
    const timings = { totalMs: 0, readMs: 0, computeMs: 0, partitions: 0 };
    let output: ArtifactRef | undefined,
      published = false,
      yieldedAt = performance.now() - 16;
    try {
      for (const [index, partition] of manifest.partitions.entries()) {
        throwIfAborted(ctx);
        const ref = task.inputs.find((input) => input.port === `partition-${index}`);
        if (!ref) throw new Error(`缺少行情分片 ${partition.file}`);
        const readAt = performance.now();
        const blob = await io.getBlob(ref);
        if (blob.size !== partition.bytes || blob.size > MAX_PARTITION_BYTES)
          throw new Error("行情分片大小无效");
        const bytes = new Uint8Array(await blob.arrayBuffer());
        timings.readMs += performance.now() - readAt;
        const computeAt = performance.now();
        engine.load_partition(bytes);
        timings.computeMs += performance.now() - computeAt;
        const previousRows = engine.processed_rows();
        for (;;) {
          const at = performance.now();
          const advanced = engine.advance();
          timings.computeMs += performance.now() - at;
          if (!advanced) break;
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
          throw new Error("行情分片行数不一致");
        timings.partitions++;
      }
      throwIfAborted(ctx);
      const at = performance.now();
      const result = JSON.parse(engine.finish()) as GridResult;
      timings.computeMs += performance.now() - at;
      if (result.results.length !== configs.length) throw new Error("参数实验结果不完整");
      timings.totalMs = performance.now() - began;
      result.timings = timings;
      output = await io.writeTypedJsonArtifact(
        `jsg-grid-${crypto.randomUUID()}`,
        "result",
        "quant/jsg-grid-result",
        result,
      );
      throwIfAborted(ctx);
      published = true;
      ctx.progress(1);
      return [output];
    } finally {
      engine.free();
      if (!published && output) await io.store.delete(artifactPath(output)).catch(() => undefined);
    }
  };
}
