import { artifactPath, type ArtifactRef, type ComputeTask } from "@bcr/core";
import {
  TrendChartProjection,
  type TrendChunk,
  type TrendIndicator,
  type TrendResult,
} from "@bcr/quant-core/trend";
import { throwIfAborted, type ArtifactIO, type WorkerContext } from "@bcr/runtime-worker";
import { readBinanceChartBars } from "./data";

export function trendChartHandler(io: ArtifactIO) {
  return async (task: ComputeTask, ctx: WorkerContext): Promise<readonly ArtifactRef[]> => {
    const { bars, from, to, minutes } = await readBinanceChartBars(io, task, ctx);
    const chunks = task.config?.["chunks"] as TrendResult["chunks"];
    const inputs = new Set(task.inputs.map((ref) => ref.id));
    if (
      !Array.isArray(chunks) ||
      chunks.some(
        (c) => !inputs.has(c.ref?.id) || !Number.isFinite(c.from) || !Number.isFinite(c.to),
      )
    )
      throw new Error("图表结果分片与冻结输入不一致");
    let stop: number | undefined, previous: TrendIndicator | undefined;
    let foundStop = task.config?.["hasTrades"] === false;
    for (const c of [...chunks].reverse().filter((c) => c.from < from)) {
      throwIfAborted(ctx);
      const chunk = await io.readJsonArtifact<TrendChunk>(c.ref, ctx);
      if (!foundStop) {
        const e = chunk.events
          .filter((e) => e.time < from && (e.kind === "stop" || e.kind === "exit"))
          .sort((a, b) => b.time - a.time)[0];
        if (e) {
          stop = e.kind === "stop" ? e.price : undefined;
          foundStop = true;
        }
      }
      previous ??= [...chunk.indicators].reverse().find((p) => p.time < from);
      if (foundStop && previous) break;
    }
    const projection = new TrendChartProjection({ from, to, minutes }, bars, stop, previous);
    for (const c of chunks.filter((c) => c.to > from && c.from < to)) {
      throwIfAborted(ctx);
      projection.append(await io.readJsonArtifact<TrendChunk>(c.ref, ctx));
    }
    throwIfAborted(ctx);
    const output = await io.writeTypedJsonArtifact(
      `trend/chart-${crypto.randomUUID()}`,
      "chart",
      "quant/trend-chart",
      projection.finish(),
    );
    if (ctx.signal.aborted) {
      await io.store.delete(artifactPath(output));
      throwIfAborted(ctx);
    }
    return [output];
  };
}
