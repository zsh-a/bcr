import { Check, CircleAlert, Sparkles } from "lucide-react";
import type { MangaAdapterExecution, MangaSource } from "./model";

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}

export function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

export function statusLabel(status: string): string {
  if (status === "done") return "DONE";
  if (status === "running") return "RUNNING";
  if (status === "error") return "ERROR";
  return "READY";
}

export function statusIcon(status: string) {
  if (status === "done") return <Check className="size-3.5" />;
  if (status === "running") return <Sparkles className="size-3.5 manga-spin" />;
  if (status === "error") return <CircleAlert className="size-3.5" />;
  return <span className="manga-stage-idle" />;
}

export function sourceLabel(source: MangaSource): string {
  return source.kind === "fixture" ? "OFFLINE FIXTURE" : "LOCAL IMAGE";
}

export function stageTone(status: string): string {
  if (status === "done") return "manga-stage-done";
  if (status === "running") return "manga-stage-running";
  if (status === "error") return "manga-stage-error";
  return "manga-stage-idle-text";
}

export function fallbackLabel(reason: MangaAdapterExecution["fallbackReason"]): string {
  if (reason === "language-unsupported") return "语言不匹配 · Review";
  if (reason === "webgpu-unavailable") return "WebGPU 不可用 · WASM";
  if (reason === "webgpu-init-failed") return "GPU 初始化失败 · WASM";
  if (reason === "model-missing") return "模型缺失 · Fixture";
  if (reason === "missing-input") return "缺少输入 · Fixture";
  if (reason === "adapter-not-ready") return "适配器不可用 · Fixture";
  return "";
}

export function executionLabel(execution: MangaAdapterExecution | undefined): string {
  if (execution === undefined) return "";
  const phase =
    execution.phase === "loading-model"
      ? "加载模型"
      : execution.phase === "running"
        ? "执行中"
        : execution.phase === "completed"
          ? "已完成"
          : execution.phase === "queued"
            ? "排队"
            : "";
  const cache = execution.cache === undefined ? "" : `CACHE ${execution.cache.toUpperCase()}`;
  const telemetry = execution.telemetry;
  const lines = telemetry === undefined ? "" : `LINES ${telemetry.completed}/${telemetry.total}`;
  const glossary =
    telemetry?.glossaryExactHits === undefined ? "" : `GLOSSARY ${telemetry.glossaryExactHits}`;
  const batch = telemetry?.batchSize === undefined ? "" : `BATCH ${telemetry.batchSize}`;
  return [
    execution.effectiveAdapter,
    execution.effectiveDevice.toUpperCase(),
    phase,
    cache,
    lines,
    glossary,
    batch,
    fallbackLabel(execution.fallbackReason),
  ]
    .filter((value) => value.length > 0)
    .join(" · ");
}
