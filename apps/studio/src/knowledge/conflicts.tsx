import { useState } from "react";
import { Button } from "@bcr/react";
import { mergeText } from "./merge";
import {
  same,
  type KnowledgeCollection,
  type KnowledgeConflict,
  type KnowledgeNote,
} from "./model";
import { notePath } from "./paths";
import { DiffView } from "./diffView";

export type ConflictChoice = "local" | "remote" | "merge";

/**
 * 合并候选：正文走 merge.ts 的保守行合并；标题与路径保留本机
 * （改名/移动必须走修改计划），其余元数据按 merge.ts 的单键规则取值。
 * 双改元数据保留本机并在预览中明示；返回 null 表示无法自动合并。
 */
export function mergeConflictNote(
  base: KnowledgeNote | null,
  local: KnowledgeNote | null,
  remote: KnowledgeNote | null,
): KnowledgeNote | null {
  if (!local || !remote) return null;
  const body = mergeText(base?.body ?? "", local.body, remote.body);
  if (body === null) return null;
  const merged: KnowledgeNote = {
    ...local,
    body,
    updatedAt: Math.max(local.updatedAt, remote.updatedAt),
  };
  for (const key of ["tags", "collectionId", "createdAt", "citations"] as const) {
    if (same(local[key], remote[key]) || same(remote[key], base?.[key])) continue;
    if (!same(local[key], base?.[key])) continue;
    Object.assign(merged, { [key]: remote[key] });
  }
  return merged;
}

export function ConflictList({
  conflicts,
  busy,
  onResolve,
}: {
  conflicts: KnowledgeConflict[];
  busy?: boolean;
  onResolve: (
    conflict: KnowledgeConflict,
    choice: ConflictChoice,
    merged: KnowledgeNote | null,
  ) => void;
}) {
  const [view, setView] = useState<Record<string, "compare" | "merge">>({});
  if (!conflicts.length) return <p className="knowledge-conflict-note">没有待处理的冲突。</p>;
  return (
    <div className="knowledge-conflict-list">
      {conflicts.map((conflict) => {
        const note = conflict.kind === "note";
        const local = (conflict.local ?? null) as KnowledgeNote | null,
          remote = (conflict.remote ?? null) as KnowledgeNote | null;
        const base = (conflict.base ?? null) as KnowledgeNote | null;
        const merged = note ? mergeConflictNote(base, local, remote) : null;
        const key = `${conflict.kind}:${conflict.key}`;
        const mode = view[key] ?? "compare";
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
        const metaChanged =
          note &&
          local &&
          remote &&
          (local.title !== remote.title || notePath(local) !== notePath(remote));
        return (
          <article key={key} className="knowledge-conflict-row">
            <h3>
              {identity}
              {note && side && "title" in side && <small>{notePath(side)}</small>}
            </h3>
            {note ? (
              <>
                {local && remote && local.title !== remote.title && (
                  <div className="knowledge-review-meta">
                    <span>
                      标题：本机「{local.title || "未命名笔记"}」· 远端「
                      {remote.title || "未命名笔记"}」
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
                {merged && (
                  <div className="knowledge-conflict-modes" role="group" aria-label="冲突内容视图">
                    <Button
                      variant="default"
                      aria-pressed={mode === "compare"}
                      onClick={() => setView({ ...view, [key]: "compare" })}
                    >
                      本机 / 远端对比
                    </Button>
                    <Button
                      variant="default"
                      aria-pressed={mode === "merge"}
                      onClick={() => setView({ ...view, [key]: "merge" })}
                    >
                      合并结果
                    </Button>
                  </div>
                )}
                {mode === "merge" && merged ? (
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
            {!merged && note && (
              <p className="knowledge-conflict-note">
                双方改动重叠，无法自动合并；请选择保留哪一侧。
              </p>
            )}
            {metaChanged && (
              <p className="knowledge-conflict-note">
                合并保留本机的标题与路径，正文改动双方保留。
              </p>
            )}
            <div className="knowledge-panel-actions">
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
                  合并
                </Button>
              )}
            </div>
          </article>
        );
      })}
    </div>
  );
}
