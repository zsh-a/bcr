import type { SearchIndex, SearchDocument } from "@bcr/core";
import type { KnowledgeContent } from "./model";

export function publishKnowledge(search: SearchIndex, content: KnowledgeContent) {
  const documents: SearchDocument[] = Object.values(content.notes).flatMap((note) => {
    const body = note.body || note.title,
      result: SearchDocument[] = [];
    for (let offset = 0; offset < body.length || offset === 0; offset += 1680) {
      result.push({
        id: `knowledge:${note.id}:${offset}`,
        source: "knowledge",
        kind: "knowledge-note",
        title: note.title || "未命名笔记",
        body: body.slice(offset, offset + 1800),
        subtitle: note.collectionId
          ? (content.collections[note.collectionId]?.name ?? "未归类")
          : "个人笔记",
        tags: note.tags,
        route: `/knowledge?note=${encodeURIComponent(note.id)}`,
        updatedAt: note.updatedAt,
      });
      if (offset + 1800 >= body.length) break;
    }
    return result;
  });
  search.replaceSource("knowledge", documents);
}
