import { findTextMatches, textVersion } from "@bcr/core";
import type { KnowledgeNote } from "./model";
import { noteRevision } from "./noteRevision";
import { notePath } from "./paths";

const normalize = (value: string) =>
  value.normalize("NFKC").toLowerCase().replace(/\s+/gu, " ").trim();
const cache = new WeakMap<
  KnowledgeNote,
  { title: string; path: string; tags: string; body: string }
>();
function searchable(note: KnowledgeNote) {
  let value = cache.get(note);
  if (!value) {
    value = {
      title: normalize(note.title),
      path: normalize(notePath(note)),
      tags: normalize(note.tags.join(" ")),
      body: normalize(note.body),
    };
    cache.set(note, value);
  }
  return value;
}

/** Shared keyword ranking and normalization for the knowledge list and Agent. */
export function searchKnowledge(
  notes: readonly KnowledgeNote[],
  query: string,
  options: { collectionId?: string; offset?: number; limit?: number } = {},
) {
  const needle = normalize(query);
  const matches = notes
    .flatMap((note) => {
      if (options.collectionId && note.collectionId !== options.collectionId) return [];
      if (!needle) return [{ note, score: 0 }];
      const value = searchable(note);
      const score =
        value.title === needle
          ? 4
          : value.title.includes(needle) || value.path.includes(needle)
            ? 3
            : value.tags.includes(needle)
              ? 2
              : value.body.includes(needle)
                ? 1
                : 0;
      return score ? [{ note, score }] : [];
    })
    .sort(
      (a, b) =>
        b.score - a.score ||
        b.note.updatedAt - a.note.updatedAt ||
        a.note.id.localeCompare(b.note.id),
    );
  const offset = options.offset ?? 0,
    limit = options.limit ?? 20;
  return {
    total: matches.length,
    hits: matches.slice(offset, offset + limit),
    nextOffset: offset + limit < matches.length ? offset + limit : null,
  };
}

export function noteEvidence(note: KnowledgeNote) {
  return {
    id: note.id,
    title: note.title,
    source: "knowledge",
    version: textVersion(note.body),
    revision: noteRevision(note),
    updatedAt: note.updatedAt,
    route: `/knowledge?note=${encodeURIComponent(note.id)}`,
    collectionId: note.collectionId,
    tags: note.tags,
    citations: note.citations.slice(0, 10).map((citation) => ({
      id: citation.id,
      title: citation.title,
      source: citation.source,
      route: citation.route,
      quote: citation.text.slice(0, 240),
    })),
    citationCount: note.citations.length,
    citationsTruncated: note.citations.length > 10,
  };
}

export function noteSearchHit(note: KnowledgeNote, query: string) {
  const match = findTextMatches(note.body, query, 1)[0] ?? null;
  const start = Math.max(0, (match?.start ?? 0) - 80);
  const end = Math.min(note.body.length, Math.max(start + 240, match?.end ?? 0));
  return {
    ...noteEvidence(note),
    preview: note.body.slice(start, end),
    previewRange: { start, end },
    match,
  };
}

export function readNotePage(note: KnowledgeNote, input: unknown) {
  if (!input || typeof input !== "object") throw new Error("读取参数无效");
  const args = input as { offset?: unknown; version?: unknown };
  const offset = args.offset ?? 0;
  if (typeof offset !== "number" || !Number.isSafeInteger(offset) || offset < 0)
    throw new Error("读取位置无效");
  const evidence = noteEvidence(note);
  if (offset > 0 && typeof args.version !== "string")
    throw new Error("后续分页必须提供首次读取返回的 version");
  if (args.version !== undefined && args.version !== evidence.version)
    throw new Error("笔记版本已变化，请重新检索并从头读取");
  return {
    ...evidence,
    offset,
    body: note.body.slice(offset, offset + 12000),
    totalLength: note.body.length,
    nextOffset: offset + 12000 < note.body.length ? offset + 12000 : null,
  };
}
