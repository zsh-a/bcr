import { useEffect, useImperativeHandle, useMemo, useRef, useState, type Ref } from "react";
import { Button } from "@bcr/react";
import type { NoteDraft, DraftSnapshot } from "./draft";
import type { KnowledgeStore } from "./store";
import type { NoteChangePlan } from "./changePlan";
import { KnowledgeDialog } from "./KnowledgeDialog";
import { NoteChangeReview } from "./NoteChangeReview";
import {
  createLiveRename,
  revertChangePlan,
  type LiveRename,
  type RenamePhase,
} from "./liveRename";
import { showUndoToast } from "./undoToast";
import "./rename.css";

/**
 * 行内重命名：输入标题即重命名（防抖约 600ms），链接改写自动完成并给出撤销提示。
 * 只有修改计划报告同名歧义引用时才弹出确认对话框（含前后对比）；
 * 旧的「预览 → 确认」四步向导不再出现。
 */
export function NoteRename({
  controller,
  snapshot,
  store,
  renameRef,
}: {
  controller: NoteDraft;
  snapshot: DraftSnapshot;
  store: KnowledgeStore;
  /** 暴露 settle/cancel 给编辑器保存屏障；可选，旧调用点不受影响。 */
  renameRef?: Ref<LiveRename>;
}) {
  const [phase, setPhase] = useState<RenamePhase>("clear");
  const [notice, setNotice] = useState("");
  const [review, setReview] = useState<NoteChangePlan | null>(null);
  const decide = useRef<((approved: boolean) => void) | null>(null);
  const titleInput = useRef<HTMLInputElement>(null);

  const renamer = useMemo(
    () =>
      createLiveRename({
        async plan(title) {
          await controller.flush();
          const plan = await store.previewRename(controller.getSnapshot().note.id, title);
          // 标题与现状一致时无需计划；清掉待重命名标记以免挡住导航。
          if (!plan.changes.length) controller.cancelRename();
          return plan;
        },
        async apply(plan) {
          if (!plan.changes.length) return;
          let current = plan;
          for (let attempt = 0; ; attempt++) {
            await controller.flush();
            try {
              await store.applyChangePlan(current, () => {
                const state = controller.getSnapshot();
                if (!controller.editable) throw new Error("编辑已暂停，本次重命名未执行");
                if (state.dirty || state.proposedTitle !== current.title)
                  throw new Error("标题已变化，交给新的输入继续");
              });
              break;
            } catch (reason) {
              const message = String(reason);
              // 新的标题输入接管本次重命名，交给防抖后的下一轮处理。
              if (/标题已变化/u.test(message)) return;
              // 草稿并发保存会让计划过期：重新预览后重试两次，不再往上抛噪音。
              if (attempt < 2 && /未保存草稿|刷新预览/u.test(message)) {
                current = await store.previewRename(current.targetId, current.title);
                if (!current.changes.length) {
                  controller.cancelRename();
                  return;
                }
                continue;
              }
              throw reason;
            }
          }
          controller.receive(store.getSnapshot().notes[current.targetId]!);
          controller.cancelRename();
          setNotice("");
          showUndoToast(
            current.rewrites > 0 ? `已重命名并更新 ${current.rewrites} 处链接` : "已重命名",
            () => {
              void revertChangePlan(store, current)
                .then(() => controller.receive(store.getSnapshot().notes[current.targetId]!))
                .catch((reason: unknown) => setNotice(String(reason)));
            },
          );
        },
        confirm(plan) {
          setReview(plan);
          return new Promise<boolean>((resolve) => {
            decide.current = resolve;
          });
        },
        phase(next) {
          setPhase(next);
          if (next === "working") setNotice("");
        },
        failed(reason) {
          setNotice(String(reason));
        },
      }),
    [controller, store],
  );
  useImperativeHandle(renameRef, () => renamer, [renamer]);
  useEffect(() => {
    const title = snapshot.proposedTitle;
    if (title !== null) renamer.schedule(title);
  }, [renamer, snapshot.proposedTitle]);

  function settleReview(approved: boolean) {
    const resolve = decide.current;
    decide.current = null;
    setReview(null);
    resolve?.(approved);
    if (!approved) {
      controller.cancelRename();
      requestAnimationFrame(() => titleInput.current?.focus({ preventScroll: true }));
    }
  }

  return (
    <>
      <input
        ref={titleInput}
        className="knowledge-title"
        aria-label="笔记标题"
        placeholder="给这个想法一个名字"
        value={snapshot.proposedTitle ?? snapshot.note.title}
        maxLength={500}
        disabled={!controller.editable}
        onChange={(event) => controller.changeTitle(event.target.value)}
      />
      {(phase === "working" || notice) && (
        <p role="status" className={`knowledge-rename-progress${notice ? " has-notice" : ""}`}>
          {notice || "正在更新引用…"}
        </p>
      )}
      <KnowledgeDialog open={!!review} title="确认重命名" onClose={() => settleReview(false)}>
        <section className="knowledge-rename-review" aria-label="重命名修改计划">
          <p>
            这些引用指向的同名笔记不止一篇，无法自动决定是否随重命名改写。将修改{" "}
            {review?.changes.length ?? 0} 篇笔记，标题及引用一次性保存；取消不会修改任何关联笔记。
          </p>
          {review?.ambiguous.length ? (
            <ul className="knowledge-rename-ambiguous" aria-label="同名歧义引用">
              {review.ambiguous.map((link, index) => (
                <li key={`${link.noteId}:${link.target}:${index}`}>
                  {link.noteTitle || "未命名笔记"} 中的 [[{link.target}]]
                  保持不变（同名笔记多于一篇）
                </li>
              ))}
            </ul>
          ) : null}
          {review && <NoteChangeReview plan={review} />}
          <div className="knowledge-rename-actions">
            <Button variant="ghost" onClick={() => settleReview(false)}>
              取消重命名
            </Button>
            <Button variant="primary" onClick={() => settleReview(true)}>
              确认全部修改
            </Button>
          </div>
        </section>
      </KnowledgeDialog>
    </>
  );
}
