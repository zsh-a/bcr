import { same, type KnowledgeNote } from "./model";
import type { KnowledgeStore } from "./store";
import type { NoteChangePlan } from "./changePlan";

/**
 * 行内重命名的“防抖 + 修改计划”驱动，与 React / DOM 解耦，便于单测。
 *
 * 流程：输入标题 → 防抖 → 保存草稿并预览修改计划 →
 * 无同名歧义直接落地（链接自动改写 + 撤销提示），有歧义先走确认对话框。
 */

export type RenamePhase = "working" | "clear";

export interface LiveRenamePort {
  /** 保存草稿并生成修改计划；实现方负责把标题提交为待重命名草稿。 */
  plan(title: string): Promise<NoteChangePlan>;
  /** 落地修改计划（实现方可因并发草稿变化而重新预览），成功后展示撤销提示。 */
  apply(plan: NoteChangePlan): Promise<void>;
  /** 计划带同名歧义时向用户确认；返回 false 表示本次重命名作废。 */
  confirm(plan: NoteChangePlan): Promise<boolean>;
  /** 安静的行内进度（仅“处理中”可见，其余交回安静状态）。 */
  phase(phase: RenamePhase): void;
  /** 落地失败的行内反馈。 */
  failed(reason: unknown): void;
}

export interface LiveRename {
  /** 记录一次标题输入；同一输入序列只落地最后一个标题。 */
  schedule(title: string): void;
  /** 立即执行尚未落地的重命名（导航/关闭前的保存屏障）。 */
  settle(): Promise<void>;
  /** 丢弃尚未落地的输入（撤销或显式取消时）。 */
  cancel(): void;
}

/** 撤销一次已落地的修改计划：精确恢复计划前内容，并用比较-交换挡住并发编辑。 */
export async function revertChangePlan(store: KnowledgeStore, plan: NoteChangePlan): Promise<void> {
  await store.update((state) => {
    const notes = { ...state.notes };
    for (const change of plan.changes) {
      const current: KnowledgeNote | undefined = notes[change.before.id];
      if (!current || !same(current, change.after))
        throw new Error("笔记已变化，无法撤销本次重命名");
      notes[change.before.id] = change.before;
    }
    return { ...state, notes };
  });
}

export function createLiveRename(port: LiveRenamePort, debounceMs = 600): LiveRename {
  // 代际计数取代定时器句柄：被取代的唤醒直接作废，浏览器与 Node 测试都适用。
  let generation = 0;
  let pending: string | null = null;
  let queue: Promise<void> = Promise.resolve();
  function drain(): Promise<void> {
    queue = queue.then(async () => {
      while (pending !== null) {
        const title = pending;
        pending = null;
        port.phase("working");
        try {
          const plan = await port.plan(title);
          if (!plan.changes.length) {
            port.phase("clear");
            continue;
          }
          if (plan.ambiguous.length && !(await port.confirm(plan))) {
            port.phase("clear");
            continue;
          }
          await port.apply(plan);
          port.phase("clear");
        } catch (reason) {
          port.phase("clear");
          port.failed(reason);
        }
      }
    });
    return queue;
  }
  return {
    schedule(title) {
      pending = title;
      const scheduled = ++generation;
      setTimeout(() => {
        if (scheduled !== generation) return;
        void drain();
      }, debounceMs);
    },
    settle() {
      generation++;
      return drain();
    },
    cancel() {
      generation++;
      pending = null;
    },
  };
}
