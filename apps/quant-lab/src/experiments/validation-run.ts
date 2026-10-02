import { contentHash, type ArtifactRef } from "@bcr/core";
import { type JsgConfig, type JsgResult } from "@bcr/quant-core";
import { Effect } from "effect";
import { readJson } from "../data/io";
import type { OperationContext } from "../execution/operation-context";
import { replayVersions, SINGLE_EXECUTOR_VERSION } from "../execution/versions";
import { validateGrid, type GridResult } from "../experiments/grid";
import {
  costStress,
  selectValidationTests,
  validationPlan,
  type ValidationRequest,
  type ValidationResult,
} from "../experiments/validation";
import {
  analyzeWalkForward,
  parameterStability,
  walkForwardSchedule,
  type WalkForwardResult,
} from "../experiments/walk-forward";
import { canonicalConfig, configKey } from "../session/config";
const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

export function createValidationOperation(context: OperationContext) {
  const { services, getState, start, progress, send, stop, release } = context;
  const runValidation = async (request: ValidationRequest) => {
    const dataset = getState().dataset;
    if (!dataset) return;
    const base = canonicalConfig(getState().draft);
    let plan: ReturnType<typeof validationPlan>, costs: ReturnType<typeof costStress>;
    try {
      plan = validationPlan(dataset.manifest, base, request);
      costs = costStress(base);
    } catch (error) {
      send({ type: "notice", error: message(error) });
      return;
    }
    const token = start("grid", "准备稳健性验证…");
    if (!token) return;
    const began = performance.now();
    const batch = async (
      configs: JsgConfig[],
      stage: { id: "train" | "test" | "cost"; label: string },
    ): Promise<GridResult> => {
      validateGrid(configs);
      progress(token, stage.label, 0, "grid");
      const memoryMB =
        256 +
        Math.ceil(
          (configs.length *
            (dataset.manifest.instruments.length * 128 +
              JSON.stringify(dataset.manifest).length * 2)) /
            1048576,
        );
      const handle = await Effect.runPromise(
        services.scheduler.submit({
          id: `jsg-study-${token.id}-${stage.id}`,
          runtime: "wasm",
          operation: "quant.grid.jsg",
          inputs: [
            { ...dataset.manifestRef, port: "manifest" },
            ...dataset.partitions.map((ref, i) => ({ ...ref, port: `partition-${i}` })),
          ],
          outputs: [
            { name: "result", type: "quant/jsg-grid-result", storage: "opfs", format: "json" },
          ],
          resources: { memoryMB, threads: 1 },
          cache: { enabled: true },
          config: { strategies: configs },
        }),
      );
      token.handle = handle;
      if (token.abort.signal.aborted) {
        await Effect.runPromise(handle.cancel);
        token.abort.signal.throwIfAborted();
      }
      const unsubscribe = handle.state.subscribe(() => {
        if (!token.abort.signal.aborted)
          progress(token, stage.label, handle.state.getSnapshot().progress);
      });
      try {
        const outputs = await Effect.runPromise(handle.await);
        token.abort.signal.throwIfAborted();
        const ref = outputs.find((r) => r.type === "quant/jsg-grid-result");
        if (!ref) throw new Error("验证没有产生结果");
        const result = await readJson<GridResult>(services, ref);
        if (result.results.length !== configs.length) throw new Error("验证结果不完整");
        return result;
      } finally {
        unsubscribe();
        token.handle = null;
      }
    };
    try {
      const training = plan.training.length
        ? await batch(plan.training, { id: "train", label: `训练 · ${plan.training.length} 组` })
        : { results: [], decodedRows: 0 };
      token.abort.signal.throwIfAborted();
      const choices = selectValidationTests(plan, training, request.objective);
      const tests = choices.length
        ? await batch(
            choices.map((c) => c.config),
            { id: "test", label: `测试 · ${choices.length} 个窗口` },
          )
        : { results: [], decodedRows: 0 };
      const costResult = await batch(costs.configs, {
        id: "cost",
        label: "成本压力 · 0.5 / 1 / 2 / 3 倍",
      });
      token.abort.signal.throwIfAborted();
      let continuous: WalkForwardResult | undefined;
      if (request.mode === "walk-forward") {
        const { config, schedule } = walkForwardSchedule(
          dataset.manifest,
          choices.map((c) => c.config),
          plan.folds,
        );
        progress(token, "连续样本外 · 延续账户回放", 0, "grid");
        const handle = await Effect.runPromise(
          services.scheduler.submit({
            id: `jsg-study-${token.id}-continuous`,
            runtime: "wasm",
            operation: "quant.backtest.jsg",
            inputs: [
              { ...dataset.manifestRef, port: "manifest" },
              ...dataset.partitions.map((r, i) => ({ ...r, port: `partition-${i}` })),
            ],
            outputs: [
              { name: "result", type: "quant/jsg-result", storage: "opfs", format: "json" },
            ],
            resources: { memoryMB: 256, threads: 1 },
            cache: { enabled: true },
            config: { strategy: config, schedule },
          }),
        );
        token.handle = handle;
        if (token.abort.signal.aborted) {
          await Effect.runPromise(handle.cancel);
          token.abort.signal.throwIfAborted();
        }
        const unsubscribe = handle.state.subscribe(() => {
          if (!token.abort.signal.aborted)
            progress(token, "连续样本外 · 延续账户回放", handle.state.getSnapshot().progress);
        });
        try {
          const outputs = await Effect.runPromise(handle.await);
          token.abort.signal.throwIfAborted();
          const resultRef = outputs.find((r) => r.type === "quant/jsg-result");
          if (!resultRef) throw new Error("连续回放没有产生结果");
          const replay = await readJson<JsgResult>(services, resultRef);
          progress(token, "分析连续样本外表现…", null, "grid");
          const analysis = await analyzeWalkForward(
            services,
            dataset.manifest,
            replay,
            config,
            plan.folds,
            token.abort.signal,
          );
          continuous = {
            config,
            schedule,
            resultRef,
            result: replay,
            ...analysis,
            stability: parameterStability(schedule, request.axes),
          };
        } finally {
          unsubscribe();
          token.handle = null;
        }
      }
      token.abort.signal.throwIfAborted();
      const result: ValidationResult = {
        version: 2,
        request: structuredClone(request),
        training: training.results,
        costBase: base,
        folds: plan.folds.map((f, i) => ({
          ...f,
          config: choices[i]!.config,
          trainMetrics: choices[i]!.trainMetrics,
          testMetrics: tests.results[i]!.metrics,
        })),
        costs: costs.rows.map((r) => ({
          multiplier: r.multiplier,
          metrics: costResult.results.find((c) => configKey(c.config) === configKey(r.config))!
            .metrics,
        })),
        ...(continuous ? { continuous } : {}),
      };
      const bytes = new TextEncoder().encode(JSON.stringify(result));
      const resultRef: ArtifactRef = {
        id: `jsg/study/${token.id}`,
        hash: contentHash(bytes),
        type: "quant/jsg-study-result",
        format: "json",
        storage: "opfs",
      };
      await Effect.runPromise(services.artifacts.put(resultRef, bytes));
      token.abort.signal.throwIfAborted();
      send({
        type: "study-finished",
        id: token.id,
        study: {
          dataset,
          result,
          run: {
            experimentId: token.experimentId,
            versions: {
              ...replayVersions(true, base),
              validation: "quant-validation-2",
              ...(continuous ? { continuousExecutor: SINGLE_EXECUTOR_VERSION } : {}),
            },
            validationMode: request.mode,
            id: token.id,
            createdAt: new Date().toISOString(),
            dataset: {
              manifestRef: dataset.manifestRef,
              partitions: dataset.partitions,
              ...(dataset.snapshot ? { snapshot: dataset.snapshot } : {}),
            },
            ...(dataset.snapshot ? { snapshot: structuredClone(dataset.snapshot) } : {}),
            name: dataset.manifest.name,
            startDate: dataset.manifest.startDate,
            endDate: dataset.manifest.endDate,
            resultRef,
            durationMs: performance.now() - began,
            cached: false,
          },
        },
      });
    } catch (error) {
      stop(token, error);
    } finally {
      release(token);
    }
  };
  return runValidation;
}
