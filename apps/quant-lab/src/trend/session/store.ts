import type { RuntimeMetadata } from "@bcr/core";
import {
  defaultBinanceRequest,
  validateBinanceRequest,
  type BinanceDataset,
  type BinanceRequest,
} from "@bcr/market-data/binance/model";
import {
  createTrendConfig,
  restoreTrendDraft,
  decodeRecordedTrendDataset,
  decodeRecordedTrendRun,
  type TrendConfig,
  type TrendRun,
} from "@bcr/quant-core/trend";

export const TREND_SESSION_KEY = "trend-research-v1";
export interface TrendSessionState {
  draftDefaultsVersion: 1;
  request: BinanceRequest;
  config: TrendConfig;
  dataset: BinanceDataset | null;
  runs: TrendRun[];
  selected: string | null;
}
export interface RestoredTrendSession {
  state: TrendSessionState;
  notice: string;
}
export const createTrendSessionState = (): TrendSessionState => ({
  draftDefaultsVersion: 1,
  request: defaultBinanceRequest(),
  config: createTrendConfig(),
  dataset: null,
  runs: [],
  selected: null,
});

/** Recover editable drafts independently; historical records must remain readable and unchanged. */
export function decodeTrendSession(raw: string | undefined): RestoredTrendSession {
  if (raw === undefined) return { state: createTrendSessionState(), notice: "" };
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("本地趋势研究记录无效");
  const data = value as Record<string, unknown>;
  if (data.draftDefaultsVersion !== undefined && data.draftDefaultsVersion !== 1)
    throw new Error("本地趋势草稿默认版本不受支持");
  if (!Array.isArray(data.runs)) throw new Error("本地趋势运行历史无效");
  const runs = data.runs.map(decodeRecordedTrendRun);
  if (new Set(runs.map((run) => run.id)).size !== runs.length)
    throw new Error("本地趋势运行标识重复");
  const dataset =
    data.dataset === null || data.dataset === undefined
      ? null
      : decodeRecordedTrendDataset(data.dataset);
  if (data.selected !== null && data.selected !== undefined && typeof data.selected !== "string")
    throw new Error("本地趋势历史选择无效");
  if (typeof data.selected === "string" && !runs.some((run) => run.id === data.selected))
    throw new Error("本地趋势历史选择不存在");
  let request: BinanceRequest;
  try {
    validateBinanceRequest(data.request as BinanceRequest);
    request = data.request as BinanceRequest;
  } catch {
    request = defaultBinanceRequest();
  }
  let config: TrendConfig;
  let notice = "";
  try {
    config = restoreTrendDraft(data.config);
    if ((data.config as { version?: number }).version !== config.version)
      notice = "参数已升级 · 保留原策略与成本门槛；历史规则保持原样";
  } catch {
    config = createTrendConfig();
    notice = "已恢复默认参数草稿；历史记录保持原样";
  }
  if (
    data.draftDefaultsVersion === undefined &&
    config.strategy.entry === "breakout" &&
    config.strategy.filter === "none"
  ) {
    config = { ...config, strategy: { ...config.strategy, filter: "background" } };
    notice = "已为新回测草稿默认启用背景过滤；其余参数及历史运行保持原样";
  }
  return {
    state: {
      ...data,
      draftDefaultsVersion: 1,
      request,
      config,
      dataset,
      runs,
      selected: (data.selected as string | undefined) ?? null,
    },
    notice,
  };
}

/** A session cannot write until its stored history has been restored successfully. */
export function createTrendSessionStore(metadata: RuntimeMetadata | undefined) {
  let restored = false;
  let restoration: Promise<RestoredTrendSession> | undefined;
  let queue = Promise.resolve();
  let persisted: string | undefined;
  return {
    restore(): Promise<RestoredTrendSession> {
      restoration ??= (async () => {
        if (!metadata) throw new Error("研究存储不可用");
        const raw = await metadata.get(TREND_SESSION_KEY);
        const result = decodeTrendSession(raw);
        persisted = raw;
        restored = true;
        return result;
      })();
      return restoration;
    },
    async save(state: TrendSessionState, signal?: AbortSignal): Promise<void> {
      if (!restored || !metadata) throw new Error("研究尚未成功恢复，已阻止覆盖本地记录");
      const text = JSON.stringify(state);
      const write = queue.then(async () => {
        signal?.throwIfAborted();
        if (text === persisted) return;
        try {
          await metadata.set(TREND_SESSION_KEY, text);
          persisted = text;
        } catch (error) {
          throw new Error(
            `研究保存失败：${error instanceof Error ? error.message : String(error)}`,
            {
              cause: error,
            },
          );
        }
      });
      // The caller receives the rejection; only the sequencing tail recovers.
      queue = write.catch(() => undefined);
      await write;
    },
  };
}
export type TrendSessionStore = ReturnType<typeof createTrendSessionStore>;
