import { useId, useMemo, useState } from "react";
import { Button } from "@bcr/react";
import { textVersion } from "@bcr/core";
import {
  type KnowledgeCollection,
  type KnowledgeConflict,
  type KnowledgeNote,
} from "../session/model";
import { notePath } from "../notes/paths";
import { DiffView } from "../editor/diffView";
import type { KnowledgeStore } from "../session/store";
import { mergeConflictNote } from "./conflictMerge";
export { mergeConflictNote } from "./conflictMerge";

export type ConflictChoice = "local" | "remote" | "merge" | "keep-both";

export async function resolveKnowledgeConflict(
  store: KnowledgeStore,
  conflict: KnowledgeConflict,
  choice: ConflictChoice,
  merged: KnowledgeNote | null,
) {
  await store.resolve(conflict, choice, merged);
  return choice === "merge"
    ? "合并结果已保存；标题与路径保留本机，双方原文已存入历史"
    : choice === "keep-both"
      ? "双方内容已保留，远端版本另存为副本；下次同步会更新到仓库"
      : choice === "remote"
        ? "已采用远端版本；本机版本已存入历史"
        : "已采用本机版本；远端版本已存入历史";
}

interface ConflictProps {
  conflict: KnowledgeConflict;
  busy?: boolean;
  onResolve: (
    conflict: KnowledgeConflict,
    choice: ConflictChoice,
    merged: KnowledgeNote | null,
  ) => void;
}

export function ConflictList({
  conflicts,
  busy,
  onResolve,
}: Omit<ConflictProps, "conflict"> & { conflicts: KnowledgeConflict[] }) {
  if (!conflicts.length) return <p className="knowledge-conflict-note">没有待处理的冲突。</p>;
  return (
    <div className="knowledge-conflict-list" aria-busy={busy}>
      {conflicts.map((conflict) => (
        <ConflictRow
          // A new conflict for the same note must never inherit an earlier merge draft.
          key={`${conflict.kind}:${conflict.key}:${textVersion(JSON.stringify(conflict))}`}
          conflict={conflict}
          busy={!!busy}
          onResolve={onResolve}
        />
      ))}
    </div>
  );
}

function ConflictRow({ conflict, busy, onResolve }: ConflictProps) {
  const [mode, setMode] = useState<"compare" | "merge" | "edit">("compare");
  const [draft, setDraft] = useState<string>();
  const id = useId();
  const note = conflict.kind === "note";
  const local = (conflict.local ?? null) as KnowledgeNote | null,
    remote = (conflict.remote ?? null) as KnowledgeNote | null,
    base = (conflict.base ?? null) as KnowledgeNote | null;
  const automatic = useMemo(
    () => (note ? mergeConflictNote(base, local, remote) : null),
    [note, base, local, remote],
  );
  const merged = draft === undefined ? automatic : mergeConflictNote(base, local, remote, draft);
  const editable = note && local && remote;
  const side = (conflict.local ?? conflict.remote ?? null) as
    | KnowledgeNote
    | KnowledgeCollection
    | null;
  const identity = side
    ? "title" in side
      ? side.title || "未命名笔记"
      : side.name
    : "已删除的条目";
  const localCollection = (conflict.local ?? null) as KnowledgeCollection | null;
  const remoteCollection = (conflict.remote ?? null) as KnowledgeCollection | null;
  return (
    <article className="knowledge-conflict-row">
      <h3>
        {identity}
        {note && side && "title" in side && <small>{notePath(side)}</small>}
      </h3>
      {note ? (
        <>
          {local && remote && local.title !== remote.title && (
            <div className="knowledge-review-meta">
              <span>
                标题：本机「{local.title || "未命名笔记"}」· 远端「{remote.title || "未命名笔记"}」
              </span>
            </div>
          )}
          {local && remote && notePath(local) !== notePath(remote) && (
            <div className="knowledge-review-meta">
              <span>路径：本机 {notePath(local)}</span>
              <strong>远端 {notePath(remote)}</strong>
            </div>
          )}
          {!local && (
            <p className="knowledge-conflict-note">本机已删除；采用远端将恢复这篇笔记。</p>
          )}
          {!remote && (
            <p className="knowledge-conflict-note">远端已删除；采用本机将保留这篇笔记。</p>
          )}
          {editable && (
            <div className="knowledge-conflict-modes" role="group" aria-label="冲突内容视图">
              <Button
                variant="default"
                aria-pressed={mode === "compare"}
                onClick={() => setMode("compare")}
              >
                本机 / 远端对比
              </Button>
              <Button
                variant="default"
                aria-pressed={mode === "merge"}
                disabled={!merged}
                onClick={() => setMode("merge")}
              >
                合并结果
              </Button>
              <Button
                variant="default"
                aria-pressed={mode === "edit"}
                onClick={() => {
                  if (draft === undefined) setDraft(automatic?.body ?? local.body);
                  setMode("edit");
                }}
              >
                编辑合并
              </Button>
            </div>
          )}
          {mode === "edit" && editable ? (
            <div className="knowledge-conflict-editor">
              <label htmlFor={id}>合并正文：{identity}</label>
              <textarea
                id={id}
                value={draft ?? automatic?.body ?? local.body}
                onChange={(event) => setDraft(event.target.value)}
                maxLength={500_000}
                disabled={busy}
                spellCheck={false}
                aria-describedby={`${id}-help`}
              />
              <p id={`${id}-help`} className="knowledge-conflict-note">
                从{automatic ? "自动合并结果" : "本机正文"}
                开始编辑，可切换对比查阅远端。草稿在此窗口保留，保存后才会应用。
              </p>
            </div>
          ) : mode === "merge" && merged ? (
            <DiffView
              before={local?.body ?? ""}
              after={merged.body}
              beforeLabel="本机"
              afterLabel="合并结果"
            />
          ) : (
            <DiffView
              before={local?.body ?? ""}
              after={remote?.body ?? ""}
              beforeLabel="本机"
              afterLabel="远端"
            />
          )}
        </>
      ) : (
        <div className="knowledge-review-meta">
          <span>名称：本机「{localCollection ? localCollection.name : "（已删除）"}」</span>
          <strong>远端「{remoteCollection ? remoteCollection.name : "（已删除）"}」</strong>
        </div>
      )}
      {!automatic && note && (
        <p className="knowledge-conflict-note">
          {editable
            ? "双方改动重叠，可编辑合并正文，或保留双方为两篇笔记。"
            : "删除与修改存在冲突，请选择要保留的结果；原版本会留在历史中。"}
        </p>
      )}
      {editable && (
        <p className="knowledge-conflict-note">
          合并保留本机标题与路径，双方原文会存入历史。合并后仍需同步到仓库。
        </p>
      )}
      {draft !== undefined && mode !== "edit" && (
        <p className="knowledge-conflict-note">合并草稿尚未应用，可继续编辑或保存合并结果。</p>
      )}
      <div className="knowledge-panel-actions">
        {editable && (
          <Button
            variant="default"
            disabled={busy}
            onClick={() => onResolve(conflict, "keep-both", merged)}
          >
            保留双方
          </Button>
        )}
        <Button
          variant="ghost"
          disabled={busy}
          onClick={() => onResolve(conflict, "local", merged)}
        >
          采用本机
        </Button>
        <Button
          variant="ghost"
          disabled={busy}
          onClick={() => onResolve(conflict, "remote", merged)}
        >
          采用远端
        </Button>
        {note && (
          <Button
            variant="primary"
            disabled={busy || !merged}
            onClick={() => onResolve(conflict, "merge", merged)}
          >
            {draft === undefined ? "合并" : "保存合并结果"}
          </Button>
        )}
      </div>
    </article>
  );
}
