/** 工作区默认元数据保留策略；UI 预览与 Scheduler 执行使用同一组参数。 */
const DAY_MS = 24 * 60 * 60 * 1_000;

export const CACHE_RETENTION = {
  maxAgeMs: 30 * DAY_MS,
  maxEntries: 200,
} as const;

export const JOURNAL_RETENTION = {
  maxAgeMs: 90 * DAY_MS,
  maxEntries: 500,
} as const;
