/**
 * 本地存储保留策略的无副作用选择器。
 *
 * 调用方传入的 entries 必须按“越新越靠前”排序或允许本函数排序；
 * protected 项永远不参与 maxEntries 配额，也不会被标记为候选。
 */
export type RetentionReason = "expired" | "over-limit";

export interface RetentionOptions {
  /** 最大存活时间；未配置时不按年龄清理。 */
  readonly maxAgeMs?: number | undefined;
  /** 最多保留多少个非保护对象；未配置时不按数量清理。 */
  readonly maxEntries?: number | undefined;
  /** 测试或跨时区调用方可提供固定当前时间。 */
  readonly now?: number | undefined;
}

export interface RetentionSelection<T> {
  readonly candidates: ReadonlyArray<{ readonly item: T; readonly reason: RetentionReason }>;
  readonly now: number;
}

/** 依据 TTL / 数量上限挑选候选，不修改输入集合。 */
export function selectRetentionCandidates<T>(
  items: ReadonlyArray<T>,
  options: RetentionOptions & {
    readonly keyOf: (item: T) => string;
    readonly createdAtOf: (item: T) => number;
    readonly isProtected?: ((item: T) => boolean) | undefined;
  },
): RetentionSelection<T> {
  const now = options.now ?? Date.now();
  const age = options.maxAgeMs === undefined ? undefined : Math.max(0, options.maxAgeMs);
  const limit =
    options.maxEntries === undefined ? undefined : Math.max(0, Math.floor(options.maxEntries));
  const protectedItems = options.isProtected ?? (() => false);
  const eligible = items
    .filter((item) => !protectedItems(item))
    .slice()
    .sort(
      (left, right) =>
        options.createdAtOf(right) - options.createdAtOf(left) ||
        options.keyOf(left).localeCompare(options.keyOf(right)),
    );
  const retained =
    limit === undefined
      ? undefined
      : new Set(eligible.slice(0, limit).map((item) => options.keyOf(item)));
  const candidates: Array<{ readonly item: T; readonly reason: RetentionReason }> = [];

  for (const item of eligible) {
    const expired = age !== undefined && options.createdAtOf(item) < now - age;
    if (expired) {
      candidates.push({ item, reason: "expired" });
    } else if (retained !== undefined && !retained.has(options.keyOf(item))) {
      candidates.push({ item, reason: "over-limit" });
    }
  }
  return { candidates, now };
}
