import type { SearchIndex, SearchDocument } from "@bcr/core";
import type { KnowledgeContent, KnowledgeNote } from "./model";

function noteDocuments(note: KnowledgeNote, subtitle: string): SearchDocument[] {
  const body = note.body || note.title,
    result: SearchDocument[] = [];
  for (let offset = 0; offset < body.length || offset === 0; offset += 1680) {
    result.push({
      id: `knowledge:${note.id}:${offset}`,
      source: "knowledge",
      kind: "knowledge-note",
      title: note.title || "未命名笔记",
      body: body.slice(offset, offset + 1800),
      subtitle,
      tags: note.tags,
      route: `/knowledge?note=${encodeURIComponent(note.id)}`,
      updatedAt: note.updatedAt,
    });
    if (offset + 1800 >= body.length) break;
  }
  return result;
}

interface Projection {
  note: KnowledgeNote;
  subtitle: string;
  documents: SearchDocument[];
}
const unchanged = (previous: Projection, note: KnowledgeNote, subtitle: string) =>
  previous.subtitle === subtitle &&
  previous.note.title === note.title &&
  previous.note.body === note.body &&
  previous.note.updatedAt === note.updatedAt &&
  previous.note.tags.length === note.tags.length &&
  previous.note.tags.every((tag, index) => tag === note.tags[index]);

/** Owned by one plugin activation. The first publish/rebuild replaces stale persisted projections. */
export function createKnowledgePublisher(search: SearchIndex) {
  let previous = new Map<string, Projection>(),
    initialized = false;
  return {
    publish(content: KnowledgeContent, rebuild = false) {
      const next = new Map<string, Projection>();
      const upsert: SearchDocument[] = [],
        remove: string[] = [];
      for (const note of Object.values(content.notes)) {
        const collection = note.collectionId
          ? (content.collections[note.collectionId]?.name ?? "未归类")
          : "个人笔记";
        const subtitle = note.path ? `${collection} · ${note.path}` : collection;
        const old = previous.get(note.id);
        if (!rebuild && old && unchanged(old, note, subtitle)) {
          next.set(note.id, old);
          continue;
        }
        const documents = noteDocuments(note, subtitle);
        next.set(note.id, { note, subtitle, documents });
        const ids = new Set(documents.map((document) => document.id));
        remove.push(
          ...(old?.documents ?? [])
            .filter((document) => !ids.has(document.id))
            .map((document) => document.id),
        );
        const oldChunks = new Map(old?.documents.map((document) => [document.id, document]));
        upsert.push(
          ...documents.filter(
            (document) => JSON.stringify(oldChunks.get(document.id)) !== JSON.stringify(document),
          ),
        );
      }
      for (const [id, old] of previous)
        if (!next.has(id)) remove.push(...old.documents.map((document) => document.id));
      if (!initialized || rebuild || !search.patchSource) {
        search.replaceSource(
          "knowledge",
          [...next.values()].flatMap((projection) => projection.documents),
        );
      } else if (upsert.length || remove.length)
        search.patchSource("knowledge", { upsert, remove });
      previous = next;
      initialized = true;
    },
  };
}

/** One-shot rebuild for consumers without a long-lived publisher. */
export function publishKnowledge(search: SearchIndex, content: KnowledgeContent) {
  createKnowledgePublisher(search).publish(content);
}
