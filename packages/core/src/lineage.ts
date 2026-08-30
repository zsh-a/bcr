import { Effect } from "effect";

/**
 * 架构文档 §3/§8：任务间血缘（谁产出、谁消费）。
 *
 * artifactStore 的内存血缘是运行时工作集；本接口把血缘的载入与
 * 写出抽象出来，持久化实现（storage-sqlite）由此支撑
 * "刷新浏览器 → 血缘仍在 → 下游失效/级联取消跨会话成立"。
 */
export interface LineageSnapshot {
  /** taskId → 产出的 artifact id（按声明顺序）。 */
  readonly outputs: ReadonlyMap<string, ReadonlyArray<string>>;
  /** artifactId → 直接消费它的 taskId。 */
  readonly consumers: ReadonlyMap<string, ReadonlyArray<string>>;
}

export interface LineageStore {
  /** 启动时载入血缘快照（刷新恢复）。 */
  readonly load: Effect.Effect<LineageSnapshot>;
  /** 提交任务时登记消费关系。 */
  readonly recordConsumption: (
    taskId: string,
    inputArtifactIds: ReadonlyArray<string>,
  ) => Effect.Effect<void>;
  /** 任务完成时登记产出关系（覆盖同任务旧记录）。 */
  readonly recordProduction: (
    taskId: string,
    outputArtifactIds: ReadonlyArray<string>,
  ) => Effect.Effect<void>;
}

/** 无持久化的默认实现：load 返回空快照，写出为 no-op。 */
export function noopLineageStore(): LineageStore {
  return {
    load: Effect.sync(() => ({ outputs: new Map(), consumers: new Map() })),
    recordConsumption: () => Effect.void,
    recordProduction: () => Effect.void,
  };
}
