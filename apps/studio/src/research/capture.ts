import { withTextCitation } from "@bcr/core";
import type { ResearchCapture } from "@bcr/react";
import { ResearchStore, citationRoute, sameExcerpt, type ResearchExcerpt } from "./index";

export async function saveResearchCapture(
  store: ResearchStore,
  collection: { readonly id: string; readonly name?: string },
  capture: ResearchCapture,
): Promise<"saved" | "duplicate"> {
  const route = citationRoute(capture.document.route);
  if (!route) throw new Error("摘录缺少有效的来源链接");
  const excerpt: ResearchExcerpt = {
    id: crypto.randomUUID(),
    documentId: capture.document.id,
    title: capture.document.title,
    source: capture.document.subtitle ?? capture.document.source,
    owner: capture.document.source,
    route: withTextCitation(route, capture.citation),
    text: capture.citation.exact,
    citation: capture.citation,
    note: capture.note.trim(),
    savedAt: Date.now(),
  };
  let result: "saved" | "duplicate" = "saved";
  await store.update((current) => {
    let target = current.collections.find((item) => item.id === collection.id);
    if (!target) {
      const name = collection.name?.trim();
      if (!name) throw new Error("目标集合已不存在，请重新选择");
      target = { id: collection.id, name, excerpts: [] };
    }
    if (target.excerpts.some((item) => sameExcerpt(item, excerpt))) {
      result = "duplicate";
      return current;
    }
    const updated = { ...target, excerpts: [...target.excerpts, excerpt] };
    return {
      ...current,
      collections: current.collections.some((item) => item.id === target.id)
        ? current.collections.map((item) => (item.id === target.id ? updated : item))
        : [...current.collections, updated],
    };
  });
  return result;
}
