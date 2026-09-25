import { useLayoutEffect, useRef, useState } from "react";
import { Button, Input } from "@bcr/react";
import { folderMoves, type NoteChangePlan } from "./changePlan";
import { KnowledgeDialog } from "./KnowledgeDialog";
import { NoteChangeReview } from "./NoteChangeReview";
import { NoteFileTree } from "./NoteFileTree";
import { countRewrittenLinks } from "./moveSummary";
import { notePath, normalizeNotePath, parentPath, pathKey } from "./paths";
import type { KnowledgeStore } from "./store";
import { showUndoToast } from "./undoToast";
import "./paths.css";

export type MoveTarget = { noteId: string } | { folder: string };

/**
 * 移动对话框：文件夹树选目标（含内联新建文件夹），点移动即落地并即时改写链接；
 * 撤销提示走 showUndoToast，落地后可在对话框里查看渲染式改动明细——不再是预览确认向导。
 * 常驻挂载以便关闭时跑完退场动画；打开时按目标重置草稿。
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
  const [dest, setDest] = useState("");
  const [created, setCreated] = useState<string[]>([]);
  const [folderName, setFolderName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{
    plan: NoteChangePlan;
    links: number;
    originals: Record<string, string>;
  } | null>(null);
  const pending = useRef(false);
  useLayoutEffect(() => {
    if (!open || !target) return;
    const snapshot = store.getSnapshot();
    const from =
      "folder" in target
        ? target.folder
        : notePath(snapshot.notes[target.noteId] ?? { id: target.noteId });
    setDest(parentPath(from));
    setCreated([]);
    setFolderName("");
    setResult(null);
    setError("");
    setBusy(false);
  }, [open, target, store]);
  const snapshot = store.getSnapshot();
  const folder = !!target && "folder" in target;
  const from = target
    ? "folder" in target
      ? target.folder
      : notePath(snapshot.notes[target.noteId] ?? { id: target.noteId })
    : "";
  const base = from.split("/").at(-1) ?? "";
  const to = `${dest ? `${dest}/` : ""}${base}`;
  const unchanged = !!from && pathKey(to) === pathKey(from);
  const intoSelf = folder && pathKey(to).startsWith(`${pathKey(from)}/`);
  async function undo(originals: Record<string, string>) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      await flush();
      const plan = await store.previewMove(originals);
      await store.applyChangePlan(plan);
      setResult(null);
    } catch (reason) {
      setError(String(reason));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  async function move() {
    if (!target || !from || unchanged || intoSelf || pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      await flush();
      const notes = store.getSnapshot().notes;
      const moves =
        "folder" in target ? folderMoves(notes, target.folder, to) : { [target.noteId]: to };
      const originals = Object.fromEntries(
        Object.keys(moves).map((id) => [id, notePath(notes[id] ?? { id })]),
      );
      const plan = await store.previewMove(moves);
      await store.applyChangePlan(plan);
      const links = countRewrittenLinks(plan.changes);
      showUndoToast(links ? `已移动并更新 ${links} 处链接` : "已移动，无需更新链接", () => {
        void undo(originals);
      });
      setResult({ plan, links, originals });
    } catch (reason) {
      setError(String(reason));
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
      {result ? (
        <section className="knowledge-move" aria-busy={busy}>
          <p role="status">
            {result.links ? `已移动并更新 ${result.links} 处链接。` : "已移动，无需更新链接。"}
            已保存到本机，下次同步时提交。
          </p>
          <NoteChangeReview plan={result.plan} />
          <div className="knowledge-move-actions">
            <Button variant="ghost" disabled={busy} onClick={() => void undo(result.originals)}>
              撤销移动
            </Button>
            <Button variant="primary" disabled={busy} onClick={onClose}>
              完成
            </Button>
          </div>
        </section>
      ) : (
        <section className="knowledge-move" aria-busy={busy}>
          <p className="knowledge-move-path">
            当前位置：<span>{from || "（未知）"}</span>
          </p>
          <p className="knowledge-move-path">
            {folder ? "文件夹将移动到：" : "将移动到："}
            <strong>{to || "根目录"}</strong>
          </p>
          <div className="knowledge-move-picker" role="group" aria-label="选择目标文件夹">
            <Button
              variant="default"
              aria-pressed={dest === ""}
              disabled={busy}
              onClick={() => setDest("")}
            >
              根目录
            </Button>
            <NoteFileTree
              notes={Object.values(snapshot.notes)}
              onSelect={(id) => {
                const note = snapshot.notes[id];
                if (note) setDest(parentPath(notePath(note)));
              }}
              onMoveFolder={(path) => setDest(path)}
            />
          </div>
          {created.length > 0 && (
            <p className="knowledge-move-created">
              新建：
              {created.map((path) => (
                <Button
                  key={path}
                  variant="ghost"
                  size="sm"
                  aria-pressed={pathKey(dest) === pathKey(path)}
                  onClick={() => setDest(path)}
                >
                  {path}
                </Button>
              ))}
            </p>
          )}
          <form
            className="knowledge-move-new-folder"
            onSubmit={(event) => {
              event.preventDefault();
              const name = folderName.trim();
              if (!name) return;
              try {
                const path = parentPath(
                  normalizeNotePath(`${dest ? `${dest}/` : ""}${name}/placeholder.md`),
                );
                setCreated([...created, path]);
                setDest(path);
                setFolderName("");
                setError("");
              } catch (reason) {
                setError(String(reason));
              }
            }}
          >
            <Input
              aria-label="新建文件夹名称"
              value={folderName}
              maxLength={120}
              disabled={busy}
              spellCheck={false}
              placeholder="新建文件夹名称"
              onChange={(event) => setFolderName(event.target.value)}
            />
            <Button variant="ghost" type="submit" disabled={busy || !folderName.trim()}>
              新建文件夹
            </Button>
          </form>
          <p className="knowledge-small">
            已解析的笔记链接会保持原目标。图片、附件及未解析链接暂不自动调整；集合与稳定 ID 不变。
          </p>
          {unchanged && <p className="knowledge-small">目标与当前位置相同，无需移动。</p>}
          {intoSelf && <p className="knowledge-small">不能将文件夹移动到自身或子目录。</p>}
          <div className="knowledge-move-actions">
            <Button variant="ghost" disabled={busy} onClick={onClose}>
              取消
            </Button>
            <Button
              variant="primary"
              disabled={busy || !from || unchanged || intoSelf}
              onClick={() => void move()}
            >
              {folder ? "移动文件夹" : "移动笔记"}
            </Button>
          </div>
        </section>
      )}
    </KnowledgeDialog>
  );
}
