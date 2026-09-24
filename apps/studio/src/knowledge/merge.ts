import { diffArrays } from "diff";
import { same, type KnowledgeContent, type KnowledgeConflict, type KnowledgeNote } from "./model";

interface Edit {
  start: number;
  end: number;
  lines: string[];
}
function edits(base: string[], next: string[]): Edit[] | null {
  const changes = diffArrays(base, next, { timeout: 80, maxEditLength: 4000 });
  if (!changes) return null;
  const result: Edit[] = [];
  let position = 0,
    current: Edit | null = null;
  for (const part of changes) {
    if (!part.added && !part.removed) {
      if (current) result.push(current);
      current = null;
      position += part.value.length;
    } else {
      current ??= { start: position, end: position, lines: [] };
      if (part.removed) {
        position += part.value.length;
        current.end = position;
      } else current.lines.push(...part.value);
    }
  }
  if (current) result.push(current);
  return result;
}
/** Conservative line merge. Overlapping edits and competing insertions retain both versions. */
export function mergeText(base: string, local: string, remote: string): string | null {
  if (local === remote || remote === base) return local;
  if (local === base) return remote;
  const lines = base.split("\n");
  const a = edits(lines, local.split("\n")),
    b = edits(lines, remote.split("\n"));
  if (!a || !b) return null;
  const combined = [...a];
  for (const right of b) {
    if (a.some((left) => same(left, right))) continue;
    if (
      a.some((left) => {
        if (left.start === left.end || right.start === right.end)
          return left.start <= right.end && right.start <= left.end;
        return left.start < right.end && right.start < left.end;
      })
    )
      return null;
    combined.push(right);
  }
  for (const edit of combined.sort((x, y) => y.start - x.start))
    lines.splice(edit.start, edit.end - edit.start, ...edit.lines);
  return lines.join("\n");
}
function mergeNote(
  base: KnowledgeNote,
  local: KnowledgeNote,
  remote: KnowledgeNote,
): KnowledgeNote | null {
  const result = { ...local, updatedAt: Math.max(local.updatedAt, remote.updatedAt) };
  const body = mergeText(base.body, local.body, remote.body);
  if (body === null) return null;
  result.body = body;
  for (const key of ["title", "path", "tags", "collectionId", "createdAt", "citations"] as const) {
    if (same(local[key], remote[key]) || same(remote[key], base[key])) continue;
    if (!same(local[key], base[key])) return null;
    Object.assign(result, { [key]: remote[key] });
  }
  return result;
}
export function mergeContent(
  base: KnowledgeContent,
  local: KnowledgeContent,
  remote: KnowledgeContent,
): { content: KnowledgeContent; conflicts: KnowledgeConflict[] } {
  const content: KnowledgeContent = { notes: {}, collections: {} },
    conflicts: KnowledgeConflict[] = [];
  for (const field of ["notes", "collections"] as const) {
    for (const id of new Set([
      ...Object.keys(base[field]),
      ...Object.keys(local[field]),
      ...Object.keys(remote[field]),
    ])) {
      const b = base[field][id] ?? null,
        l = local[field][id] ?? null,
        r = remote[field][id] ?? null;
      let selected = l;
      if (same(l, r) || same(b, r)) selected = l;
      else if (same(b, l)) selected = r;
      else {
        const merged =
          field === "notes" && b && l && r
            ? mergeNote(b as KnowledgeNote, l as KnowledgeNote, r as KnowledgeNote)
            : null;
        if (merged) selected = merged;
        else
          conflicts.push({
            key: id,
            kind: field === "notes" ? "note" : "collection",
            base: b,
            local: l,
            remote: r,
          });
      }
      if (selected) Object.assign(content[field], { [id]: selected });
    }
  }
  return { content, conflicts };
}
