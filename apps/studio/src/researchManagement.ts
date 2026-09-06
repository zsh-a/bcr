import { sameExcerpt, type ResearchLibrary, type ResearchExcerpt } from "./research";

export function renameCollection(
  library: ResearchLibrary,
  id: string,
  name: string,
): ResearchLibrary {
  const title = name.trim();
  if (!title || title.length > 120) throw new Error("集合名称需为 1–120 个字符");
  if (!library.collections.some((item) => item.id === id)) throw new Error("集合已不存在");
  return {
    ...library,
    collections: library.collections.map((item) =>
      item.id === id ? { ...item, name: title } : item,
    ),
  };
}

export function deleteCollection(library: ResearchLibrary, id: string): ResearchLibrary {
  return { ...library, collections: library.collections.filter((item) => item.id !== id) };
}

export function moveExcerpt(
  library: ResearchLibrary,
  sourceId: string,
  targetId: string,
  excerptId: string,
): ResearchLibrary {
  const source = library.collections.find((item) => item.id === sourceId);
  const target = library.collections.find((item) => item.id === targetId);
  const excerpt = source?.excerpts.find((item) => item.id === excerptId);
  if (!excerpt || !target || sourceId === targetId) throw new Error("请选择有效的目标集合");
  if (target.excerpts.some((item) => item.id === excerpt.id || sameExcerpt(item, excerpt))) {
    throw new Error("目标集合已有该摘录，已保留两边的笔记，请先整理重复内容");
  }
  return {
    ...library,
    collections: library.collections.map((item) =>
      item.id === sourceId
        ? { ...item, excerpts: item.excerpts.filter((entry) => entry.id !== excerptId) }
        : item.id === targetId
          ? { ...item, excerpts: [...item.excerpts, excerpt] }
          : item,
    ),
  };
}

// Snapshot identity survives moves. The cache also retains edits when browser storage fails.
const drafts = new Map<string, string>();
const failed = new Set<string>();
export const draftFailed = (item: ResearchExcerpt): boolean => failed.has(draftKey(item));
export function draftKey(item: ResearchExcerpt): string {
  return `bcr/research-draft/v1/${JSON.stringify([item.id, item.documentId, item.savedAt])}`;
}
export function readDraft(item: ResearchExcerpt, storage: Pick<Storage, "getItem">): string {
  const key = draftKey(item);
  return drafts.get(key) ?? storage.getItem(key) ?? item.draft ?? item.note;
}
export function writeDraft(
  item: ResearchExcerpt,
  text: string,
  storage: Pick<Storage, "setItem">,
): void {
  const key = draftKey(item);
  drafts.set(key, text);
  try {
    storage.setItem(key, text);
    failed.delete(key);
  } catch (error) {
    failed.add(key);
    throw error;
  }
}
export function clearDraft(
  item: ResearchExcerpt,
  saved: string,
  storage: Pick<Storage, "getItem" | "removeItem">,
): void {
  const key = draftKey(item);
  let value = drafts.get(key);
  if (value === undefined) {
    try {
      value = storage.getItem(key) ?? undefined;
    } catch {
      return;
    }
  }
  if (value !== saved) return;
  // The durable note already contains this value; a leftover equal draft is harmless.
  try {
    storage.removeItem(key);
  } catch {
    /* Storage may be unavailable. */
  }
  drafts.delete(key);
  failed.delete(key);
}

/** Run only after a successful library write (or successful initial load). */
export function pruneDrafts(
  library: ResearchLibrary,
  storage: Pick<Storage, "length" | "key" | "removeItem">,
): void {
  const live = new Set(
    library.collections.flatMap((collection) => collection.excerpts.map(draftKey)),
  );
  for (const key of drafts.keys())
    if (!live.has(key)) {
      drafts.delete(key);
      failed.delete(key);
    }
  const obsolete: string[] = [];
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (key?.startsWith("bcr/research-draft/v1/") && !live.has(key)) obsolete.push(key);
  }
  const errors: unknown[] = [];
  for (const key of obsolete) {
    try {
      storage.removeItem(key);
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length) throw new Error("部分已删除摘录的草稿尚未清理，请重试");
}

// Access the browser getter lazily so blocked storage still leaves in-memory edits intact.
export const browserDraftStorage = {
  get length() {
    return window.localStorage.length;
  },
  key: (index: number) => window.localStorage.key(index),
  getItem: (key: string) => window.localStorage.getItem(key),
  setItem: (key: string, value: string) => window.localStorage.setItem(key, value),
  removeItem: (key: string) => window.localStorage.removeItem(key),
};
