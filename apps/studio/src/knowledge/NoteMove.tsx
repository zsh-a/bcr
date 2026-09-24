import { useId, useLayoutEffect, useRef, useState } from "react";
import { Button, Input } from "@bcr/react";
import { folderMoves, type NoteChangePlan } from "./changePlan";
import { KnowledgeDialog } from "./KnowledgeDialog";
import { NoteChangeReview } from "./NoteChangeReview";
import { notePath } from "./paths";
import type { KnowledgeStore } from "./store";

export type MoveTarget = { noteId: string } | { folder: string };

/**
 * 移动对话框。常驻挂载以便关闭时跑完退场动画；打开时按目标重置草稿，
 * 与原先的按需挂载行为一致。
 */
export function NoteMove({
  open,
  target,
  store,
  flush,
  onClose,
}: {
  open: boolean;
  target: MoveTarget | null;
  store: KnowledgeStore;
  flush: () => Promise<void>;
  onClose: () => void;
}) {
  const [original, setOriginal] = useState("");
  const [path, setPath] = useState("");
  const [plan, setPlan] = useState<NoteChangePlan | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const id = useId();
  useLayoutEffect(() => {
    if (!open || !target) return;
    const from =
      "folder" in target
        ? target.folder
        : notePath(store.getSnapshot().notes[target.noteId] ?? { id: target.noteId });
    setOriginal(from);
    setPath(from);
    setPlan(null);
    setError("");
    setBusy(false);
  }, [open, target, store]);
  const folder = !!target && "folder" in target;
  async function run(confirm: boolean) {
    if (!target || pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      if (confirm && plan) {
        await store.applyChangePlan(plan);
        onClose();
      } else {
        await flush();
        const moves =
          "folder" in target
            ? folderMoves(store.getSnapshot().notes, target.folder, path)
            : { [target.noteId]: path };
        setPlan(await store.previewMove(moves));
      }
    } catch (reason) {
      setError(String(reason));
      setPlan(null);
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  return (
    <KnowledgeDialog
      open={open}
      title={folder ? "移动文件夹" : "移动笔记"}
      onClose={() => {
        if (!pending.current) onClose();
      }}
      error={error}
    >
      <section className="knowledge-rename-review knowledge-move" aria-busy={busy}>
        <p className="knowledge-small">当前位置：{original}</p>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void run(false);
          }}
        >
          <label htmlFor={id}>{folder ? "目标文件夹路径" : "目标笔记路径"}</label>
          <Input
            id={id}
            value={path}
            maxLength={500}
            disabled={busy}
            spellCheck={false}
            aria-describedby={`${id}-hint`}
            onChange={(event) => {
              setPath(event.target.value);
              setPlan(null);
              setError("");
            }}
          />
          <p id={`${id}-hint`} className="knowledge-small">
            {folder
              ? "填写新的完整文件夹路径，留空移至根目录；包含全部子文件夹。"
              : "例如：项目/产品设计.md。目录随路径建立，标题保持不变。"}
          </p>
          <Button variant="ghost" disabled={busy} type="submit">
            {busy ? "处理中…" : plan ? "刷新预览" : "预览移动"}
          </Button>
        </form>
        {plan && (
          <>
            <p role="status">
              将修改 {plan.changes.length} 篇笔记。路径和受影响的笔记引用一并保存。
            </p>
            <NoteChangeReview plan={plan} />
          </>
        )}
        <p className="knowledge-small">
          已解析的笔记链接会保持原目标。图片、附件及未解析链接暂不自动调整；集合与稳定 ID 不变。
        </p>
        <div className="knowledge-rename-actions">
          <Button variant="ghost" disabled={busy} onClick={onClose}>
            取消
          </Button>
          <Button
            variant="primary"
            disabled={busy || !plan?.changes.length || !!error}
            onClick={() => void run(true)}
          >
            确认移动
          </Button>
        </div>
      </section>
    </KnowledgeDialog>
  );
}
