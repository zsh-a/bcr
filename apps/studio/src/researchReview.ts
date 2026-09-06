import type { SearchDocument, SearchIndex, TextRange } from "@bcr/core";
import {
  citationRoute,
  excerptFromResult,
  type ResearchLibrary,
  type ResearchLink,
} from "./research";

export function linkPreview(
  document: SearchDocument,
  match: TextRange,
  now = Date.now(),
): ResearchLink {
  if (
    !Number.isSafeInteger(match.start) ||
    !Number.isSafeInteger(match.end) ||
    match.start < 0 ||
    match.end <= match.start ||
    match.end > (document.body?.length ?? 0) ||
    match.end - match.start > 512
  )
    throw new Error("请选择 1–512 个字符作为引用");
  if (!document.citation || !document.body || !citationRoute(document.route))
    throw new Error("请选择有精确引用的正文来源");
  const item = excerptFromResult({ document, match, score: 0, snippet: "", matchedTerms: [] }, now);
  if (!item.citation || !item.owner) throw new Error("请选择 1–512 个字符作为引用");
  return {
    documentId: item.documentId,
    title: item.title,
    source: item.source,
    owner: item.owner,
    route: item.route,
    text: item.text,
    citation: item.citation,
    linkedAt: now,
  };
}
export function relinkExcerpt(
  library: ResearchLibrary,
  collectionId: string,
  excerptId: string,
  document: SearchDocument,
  match: TextRange,
  expectedLinks: number,
  search: SearchIndex,
  now = Date.now(),
): ResearchLibrary {
  const excerpt = library.collections
    .find((item) => item.id === collectionId)
    ?.excerpts.find((item) => item.id === excerptId);
  if (!excerpt || (excerpt.links?.length ?? 0) !== expectedLinks)
    throw new Error("摘录或关联记录已变化，请重新打开核对面板");
  const current = search.documents().find((item) => item.id === document.id);
  if (
    !search.isSourceLive(document.source) ||
    !current ||
    JSON.stringify(current) !== JSON.stringify(document)
  )
    throw new Error("来源已变化或尚未加载，请重新选择当前正文");
  const link = linkPreview(current, match, now);
  return {
    ...library,
    collections: library.collections.map((collection) =>
      collection.id !== collectionId
        ? collection
        : {
            ...collection,
            excerpts: collection.excerpts.map((item) =>
              item.id !== excerptId ? item : { ...item, links: [...(item.links ?? []), link] },
            ),
          },
    ),
  };
}
