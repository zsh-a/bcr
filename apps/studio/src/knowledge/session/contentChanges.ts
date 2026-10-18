import type { KnowledgeContent } from "./model";
import { sameRecord } from "./comparison";

type RecordField = "notes" | "collections" | "attachments";
export interface ContentChange {
  field: RecordField | "folders";
  id: string;
  label: string;
  change: "新增" | "修改" | "删除";
}
const emptyRecords: Readonly<Record<string, never>> = Object.freeze({});
const recordDiffs = new WeakMap<object, WeakMap<object, readonly ContentChange[]>>();
const snapshots = new WeakMap<
  object,
  {
    local: readonly object[];
    base: readonly object[];
    changes: readonly ContentChange[];
  }
>();
const fields = ["notes", "collections", "attachments"] as const;

function recordChanges(local: KnowledgeContent, base: KnowledgeContent, field: RecordField) {
  const left = local[field] ?? emptyRecords,
    right = base[field] ?? emptyRecords;
  if (left === right) return [];
  let pairs = recordDiffs.get(left);
  const cached = pairs?.get(right);
  if (cached) return cached;
  const changes: ContentChange[] = [];
  for (const id of new Set([...Object.keys(left), ...Object.keys(right)])) {
    if (sameRecord(left[id], right[id])) continue;
    const value = left[id] ?? right[id];
    if (!value) continue;
    changes.push({
      field,
      id,
      label: "title" in value ? value.title || "未命名笔记" : value.name,
      change: !left[id] ? "删除" : !right[id] ? "新增" : "修改",
    });
  }
  if (!pairs) recordDiffs.set(left, (pairs = new WeakMap()));
  pairs.set(right, changes);
  return changes;
}

/** One cached diff feeds status counts, popovers and automatic synchronization. */
export function contentChanges(
  local: KnowledgeContent,
  base: KnowledgeContent,
): readonly ContentChange[] {
  const left = [...fields.map((field) => local[field] ?? emptyRecords), local.folders];
  const right = [...fields.map((field) => base[field] ?? emptyRecords), base.folders];
  const cached = snapshots.get(local.notes);
  if (
    cached &&
    left.every((value, i) => value === cached.local[i]) &&
    right.every((value, i) => value === cached.base[i])
  )
    return cached.changes;
  const changes = fields.flatMap((field) => recordChanges(local, base, field));
  if (!sameRecord(local.folders, base.folders))
    changes.push({ field: "folders", id: "", label: "文件夹结构", change: "修改" });
  snapshots.set(local.notes, { local: left, base: right, changes });
  return changes;
}
