import type { SearchDocument, SearchIndex } from "@bcr/core";
import type { ResearchLibrary } from "./research";

export const isResearchResult = (document: SearchDocument): boolean =>
  document.kind === "research-note" || document.kind === "research-excerpt";
export interface ResearchTarget {
  readonly collection: string;
  readonly excerpt: string;
  readonly field: "note" | "text";
  readonly offset: number;
}
export function researchTarget(document: SearchDocument): ResearchTarget | undefined {
  if (!isResearchResult(document) || !document.route?.startsWith("/research?")) return;
  const url = new URL(document.route, "https://bcr.invalid");
  const collection = url.searchParams.get("collection"),
    excerpt = url.searchParams.get("excerpt");
  const field = url.searchParams.get("field"),
    offset = Number(url.searchParams.get("offset"));
  if (
    url.origin !== "https://bcr.invalid" ||
    url.pathname !== "/research" ||
    !collection ||
    !excerpt ||
    (field !== "note" && field !== "text") ||
    (field === "note") !== (document.kind === "research-note") ||
    !Number.isSafeInteger(offset) ||
    offset < 0
  )
    return;
  return { collection, excerpt, field, offset };
}
export const researchSource = (id: string): string => `research-collection:${id}`;
export function researchDocuments(library: ResearchLibrary): SearchDocument[] {
  return library.collections.flatMap((collection) =>
    collection.excerpts.flatMap((item) =>
      (["text", "note"] as const).flatMap((field) => {
        const value = item[field];
        if (!value.trim()) return [];
        const documents: SearchDocument[] = [];
        for (let offset = 0; offset < value.length; offset += 1680) {
          const params = new URLSearchParams({
            collection: collection.id,
            excerpt: item.id,
            field,
            offset: String(offset),
          });
          documents.push({
            id: `research:${JSON.stringify([collection.id, item.id, field, offset])}`,
            source: researchSource(collection.id),
            kind: field === "note" ? "research-note" : "research-excerpt",
            title: item.title,
            subtitle: `${collection.name} · ${field === "note" ? "已保存笔记" : "摘录正文"} · ${item.source}`,
            body: value.slice(offset, offset + 1800),
            route: `/research?${params}`,
            updatedAt: item.savedAt,
          });
          if (offset + 1800 >= value.length) break;
        }
        return documents;
      }),
    ),
  );
}
/** Publish only durable snapshots. A failed save never calls this with speculative edits. */
export function publishResearch(search: SearchIndex, library: ResearchLibrary): void {
  const grouped = new Map<string, SearchDocument[]>();
  for (const document of researchDocuments(library)) {
    const group = grouped.get(document.source) ?? [];
    group.push(document);
    grouped.set(document.source, group);
  }
  const previous = new Set(
    search
      .documents()
      .filter(isResearchResult)
      .map((item) => item.source),
  );
  for (const source of previous) if (!grouped.has(source)) search.removeSource(source);
  for (const [source, documents] of grouped) search.replaceSource(source, documents);
}
