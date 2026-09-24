import { useRef, useState } from "react";
import type { NoteDraft, DraftSnapshot } from "./draft";
import type { KnowledgeStore } from "./store";
import type { NoteChangePlan } from "./changePlan";
import { KnowledgeDialog } from "./KnowledgeDialog";
import { NoteChangeReview } from "./NoteChangeReview";
import "./rename.css";

export function NoteRename({
  controller,
  snapshot,
  store,
}: {
  controller: NoteDraft;
  snapshot: DraftSnapshot;
  store: KnowledgeStore;
}) {
  const [plan, setPlan] = useState<NoteChangePlan | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const titleInput = useRef<HTMLInputElement>(null);
  const pending = snapshot.proposedTitle !== null;
  const cancel = () => {
    if (busy) return;
    setPlan(null);
    setError("");
    controller.cancelRename();
    requestAnimationFrame(() => titleInput.current?.focus({ preventScroll: true }));
  };
  async function preview() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await controller.flush();
      const current = controller.getSnapshot();
      if (current.proposedTitle === null) return;
      const next = await store.previewRename(current.note.id, current.proposedTitle);
      setPlan(next);
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy(false);
    }
  }
  async function confirm() {
    if (!plan || busy) return;
    setBusy(true);
    setError("");
    try {
      await store.applyChangePlan(plan, () => {
        const current = controller.getSnapshot();
        if (!controller.editable || current.dirty || current.proposedTitle !== plan.title)
          throw new Error("草稿已变化，请刷新预览后重新确认");
      });
      controller.receive(store.getSnapshot().notes[plan.targetId]!);
      controller.cancelRename();
      setPlan(null);
      requestAnimationFrame(() => titleInput.current?.focus({ preventScroll: true }));
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy(false);
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
        disabled={!controller.editable || busy}
        onChange={(event) => controller.changeTitle(event.target.value)}
      />
      {pending && (
        <div className="knowledge-rename-pending">
          <span>新标题待确认 · 正文仍自动保存</span>
          <button
            type="button"
            className="knowledge-button"
            disabled={busy}
            onClick={() => void preview()}
          >
            预览重命名
          </button>
          <button type="button" className="knowledge-button" disabled={busy} onClick={cancel}>
            取消重命名
          </button>
        </div>
      )}
      {error && !plan && (
        <p role="alert" className="knowledge-alert">
          {error}
        </p>
      )}
      <KnowledgeDialog open={!!plan} title="确认重命名" onClose={cancel} error={error}>
        <section className="knowledge-rename-review" aria-label="重命名修改计划" aria-busy={busy}>
          <p>
            将修改 {plan?.changes.length ?? 0}{" "}
            篇笔记。标题及引用一次性保存；取消不会修改任何关联笔记。
          </p>
          <p className="knowledge-small">
            预览后若笔记或引用范围发生变化，需要刷新预览并重新确认。
          </p>
          {plan && <NoteChangeReview plan={plan} />}
          <div className="knowledge-rename-actions">
            <button type="button" className="knowledge-button" disabled={busy} onClick={cancel}>
              取消重命名
            </button>
            <button
              type="button"
              className="knowledge-button"
              disabled={busy}
              onClick={() => void preview()}
            >
              刷新预览
            </button>
            <button
              type="button"
              className="knowledge-button knowledge-rename-confirm"
              disabled={busy || !!error || !plan?.changes.length}
              onClick={() => void confirm()}
            >
              {busy ? "处理中…" : "确认全部修改"}
            </button>
          </div>
        </section>
      </KnowledgeDialog>
    </>
  );
}
