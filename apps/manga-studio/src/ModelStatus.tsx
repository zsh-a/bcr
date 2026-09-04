import { Database, Download, RotateCcw, Trash2 } from "lucide-react";
import type { MangaModelCacheInfo } from "./model-cache";
import type { MangaModelRecord, MangaModelStatus } from "./model-registry";
import type { MangaAdapterExecution } from "./model";

function modelStatusLabel(status: MangaModelStatus): string {
  if (status === "ready") return "READY · 可复用";
  if (status === "loading") return "LOADING · Worker";
  if (status === "error") return "ERROR · 可重试";
  return "NOT LOADED · 懒加载";
}

export function ModelStatusNote({
  record,
  execution,
  disabled,
  onPreload,
  onClear,
}: {
  readonly record: MangaModelRecord | undefined;
  readonly execution: MangaAdapterExecution;
  readonly disabled: boolean;
  readonly onPreload: () => void;
  readonly onClear: () => void;
}) {
  const status = record?.status ?? "unknown";
  const loadDuration =
    record?.lastLoadDurationMs === undefined
      ? ""
      : ` · 最近加载 ${(record.lastLoadDurationMs / 1000).toFixed(1)}s`;
  const detail =
    record?.lastError ??
    (status === "ready"
      ? `模型已成功加载${loadDuration}，后续任务可复用 Manga 专属缓存`
      : "首次执行将在 Worker 中按需加载；可先预加载");
  const canPreload = execution.model !== undefined && execution.model.trim().length > 0;
  return (
    <div className="manga-model-status" data-model-status={status}>
      <span>MODEL CACHE</span>
      <strong>{modelStatusLabel(status)}</strong>
      <small>{detail}</small>
      <div className="manga-model-actions">
        <button
          type="button"
          className="manga-model-action"
          data-model-preload={execution.model ?? ""}
          disabled={disabled || !canPreload || status === "loading"}
          onClick={onPreload}
        >
          <Download className="size-3" /> {status === "loading" ? "加载中…" : "预加载模型"}
        </button>
        {status === "ready" && (
          <button
            type="button"
            className="manga-model-action manga-model-action-danger"
            disabled={disabled}
            onClick={onClear}
          >
            <Trash2 className="size-3" /> 清理
          </button>
        )}
      </div>
    </div>
  );
}

export function ModelCacheSummary({
  info,
  online,
  busy,
  onRefresh,
  onClear,
}: {
  readonly info: MangaModelCacheInfo | null;
  readonly online: boolean;
  readonly busy: boolean;
  readonly onRefresh: () => void;
  readonly onClear: () => void;
}) {
  const status =
    info === null
      ? "检查缓存…"
      : !info.supported
        ? "浏览器缓存不可用"
        : `${info.entryCount} 个文件 · ${online ? "ONLINE" : "OFFLINE"}`;
  return (
    <div
      className="manga-model-cache-summary"
      data-model-cache={info?.supported ? "ready" : "unknown"}
    >
      <div>
        <span>
          <Database className="size-3" /> MODEL STORAGE
        </span>
        <strong>{status}</strong>
      </div>
      <div className="manga-model-actions">
        <button
          type="button"
          className="manga-model-action"
          disabled={busy}
          onClick={onRefresh}
          aria-label="刷新模型缓存状态"
        >
          <RotateCcw className="size-3" /> 刷新
        </button>
        {info !== null && info.supported && info.entryCount > 0 && (
          <button
            type="button"
            className="manga-model-action manga-model-action-danger"
            disabled={busy}
            onClick={onClear}
          >
            <Trash2 className="size-3" /> 清理全部
          </button>
        )}
      </div>
      <small>
        {online
          ? "首次预加载需要网络；完成后可在离线环境复用已缓存文件。"
          : "当前离线：仅能复用已缓存文件，首次下载会失败。"}
      </small>
    </div>
  );
}
