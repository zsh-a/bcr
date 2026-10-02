import type { ReaderTocItem } from "@bcr/reader-core";

export interface TocRow {
  readonly item: ReaderTocItem;
  readonly depth: number;
  readonly ordinal: number;
}

export function tocMatches(item: ReaderTocItem, query: string): boolean {
  return (
    !query ||
    item.label.toLocaleLowerCase().includes(query) ||
    (item.children ?? []).some((child) => tocMatches(child, query))
  );
}

/** Number before filtering so search and collapsed branches retain stable positions. */
export function visibleTocRows(
  items: readonly ReaderTocItem[],
  collapsed: ReadonlySet<string>,
  query = "",
): TocRow[] {
  const rows: TocRow[] = [];
  let ordinal = 0;
  const visit = (entries: readonly ReaderTocItem[], depth: number, visible: boolean) => {
    for (const item of entries) {
      ordinal++;
      const matches = visible && tocMatches(item, query);
      if (matches) rows.push({ item, depth, ordinal });
      visit(item.children ?? [], depth + 1, matches && (!!query || !collapsed.has(item.id)));
    }
  };
  visit(items, 0, true);
  return rows;
}

export function tocAncestors(items: readonly ReaderTocItem[], id: string): string[] {
  for (const item of items) {
    if (item.id === id) return [];
    const children = item.children ?? [];
    if (children.some((child) => child.id === id)) return [item.id];
    const path = tocAncestors(children, id);
    if (path.length) return [item.id, ...path];
  }
  return [];
}

export function tocBranches(items: readonly ReaderTocItem[]): string[] {
  return items.flatMap((item) =>
    item.children?.length ? [item.id, ...tocBranches(item.children)] : [],
  );
}
