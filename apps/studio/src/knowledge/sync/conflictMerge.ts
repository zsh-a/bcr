import { decodeNote, type KnowledgeConflict, type KnowledgeNote } from "../session/model";
import { mergeMetadata, mergeText } from "./merge";

/** Manual body edits share the same metadata rules as automatic merges. */
export function mergeConflictNote(
  base: KnowledgeNote | null,
  local: KnowledgeNote | null,
  remote: KnowledgeNote | null,
  editedBody?: string,
): KnowledgeNote | null {
  if (!local || !remote) return null;
  const body = editedBody ?? mergeText(base?.body ?? "", local.body, remote.body);
  if (body === null) return null;
  const merged = { ...local, body, updatedAt: Math.max(local.updatedAt, remote.updatedAt) };
  mergeMetadata(merged, local, remote, base, ["tags", "collectionId", "createdAt", "citations"]);
  return merged;
}

/** Only the body is editable here; renames and moves still require a change plan. */
export function validateConflictMerge(
  conflict: KnowledgeConflict,
  candidate?: KnowledgeNote | null,
) {
  if (conflict.kind !== "note" || !conflict.local || !conflict.remote || !candidate)
    throw new Error("请选择双方都保留的笔记进行正文合并。");
  const valid = decodeNote(candidate);
  const local = conflict.local as KnowledgeNote;
  if (valid.id !== local.id || valid.title !== local.title || valid.path !== local.path)
    throw new Error("合并保留本机标题与路径，请重新打开冲突后编辑正文。");
  const merged = mergeConflictNote(
    conflict.base as KnowledgeNote | null,
    local,
    conflict.remote as KnowledgeNote,
    valid.body,
  )!;
  return decodeNote({ ...merged, updatedAt: Date.now() });
}
