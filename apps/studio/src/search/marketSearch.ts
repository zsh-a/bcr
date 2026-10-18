import type { SearchDocument, SearchIndex } from "@bcr/core";

let documents: Promise<ReadonlyArray<SearchDocument>> | undefined;
const publications = new WeakMap<SearchIndex, Promise<void>>();

/** File/task updates must not rebuild this fixed catalog or rewrite its search source. */
export function prepareMarketSearch(search: SearchIndex): Promise<void> {
  const existing = publications.get(search);
  if (existing) return existing;
  if (!documents) {
    const pending = import("./marketDocuments").then((module) => module.marketDocuments());
    documents = pending;
    void pending.catch(() => {
      if (documents === pending) documents = undefined;
    });
  }
  const operation = Promise.all([search.ready, documents]).then(([, items]) => {
    search.replaceSource("market", items);
  });
  publications.set(search, operation);
  void operation.catch(() => {
    if (publications.get(search) === operation) publications.delete(search);
  });
  return operation;
}
