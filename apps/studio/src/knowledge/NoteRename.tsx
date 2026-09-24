import { useRef, useState } from "react";
import type { NoteDraft, DraftSnapshot } from "./draft";
import type { KnowledgeStore } from "./store";
import type { NoteChangePlan } from "./changePlan";
import { KnowledgeDialog } from "./KnowledgeDialog";
import "./rename.css";

function excerpt(before: string, after: string) {
  let start = 0,
    end = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start++;
  while (
    end < before.length - start &&
    end < after.length - start &&
    before[before.length - end - 1] === after[after.length - end - 1]
  )
    end++;
  const from = Math.max(0, start - 100);
  const clip = (text: string) => {
    const to = Math.min(text.length, text.length - end + 100);
    const shown = text.slice(from, Math.min(to, from + 4000));
    return `${from ? "…\n" : ""}${shown}${to < text.length || to > from + 4000 ? "\n…" : ""}`;
  };
  return [clip(before), clip(after)];
}

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
  const [selected, setSelected] = useState(0);
  const [full, setFull] = useState(false);
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
      setSelected(0);
      setFull(false);
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
  const change = plan?.changes[selected];
  const snippets = change ? excerpt(change.before.body, change.after.body) : [];
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
          <div className="knowledge-rename-notes" aria-label="受影响的笔记">
            {plan?.changes.map((item, index) => (
              <button
                type="button"
                key={item.before.id}
                className="knowledge-button"
                aria-pressed={selected === index}
                onClick={() => {
                  setSelected(index);
                  setFull(false);
                }}
              >
                {item.before.title || "未命名笔记"}
                <small>
                  {item.before.id === plan.targetId ? "标题" : "引用"} ·{" "}
                  {item.before.id.slice(0, 8)}
                </small>
              </button>
            ))}
          </div>
          {change && (
            <div className="knowledge-rename-diff">
              {change.before.title !== change.after.title && (
                <div className="knowledge-rename-title-diff">
                  <span>原标题：{change.before.title || "未命名笔记"}</span>
                  <strong>新标题：{change.after.title || "未命名笔记"}</strong>
                </div>
              )}
              {change.before.body !== change.after.body && (
                <>
                  <button
                    type="button"
                    className="knowledge-button"
                    aria-pressed={full}
                    onClick={() => setFull(!full)}
                  >
                    {full ? "仅看变更片段" : "查看完整正文"}
                  </button>
                  <div className="knowledge-rename-columns">
                    <div>
                      <h3>修改前</h3>
                      <pre>{full ? change.before.body : snippets[0]}</pre>
                    </div>
                    <div>
                      <h3>修改后</h3>
                      <pre>{full ? change.after.body : snippets[1]}</pre>
                    </div>
                  </div>
                  {!full && (
                    <p className="knowledge-small">
                      仅显示变更附近片段，省略内容以 … 标记，可展开完整正文。
                    </p>
                  )}
                </>
              )}
            </div>
          )}
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
