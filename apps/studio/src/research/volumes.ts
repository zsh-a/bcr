export const RESEARCH_LIMIT = 16 * 1024 * 1024;
export const DEFAULT_VOLUME_BYTES = 128 * 1024 * 1024;
export interface ResearchVolumeBook {
  readonly book: string;
  readonly target: string;
  readonly title: string;
  readonly hash: string;
  readonly volume: number;
}
export interface ResearchVolumeCatalog {
  readonly format: "bcr-research-volumes";
  readonly version: 1;
  readonly researchHash: string;
  readonly total: number;
  readonly books: ReadonlyArray<ResearchVolumeBook>;
}
export function decodeVolumeCatalog(value: unknown): ResearchVolumeCatalog {
  const catalog = value as ResearchVolumeCatalog | null;
  const hash = (value: unknown) => typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
  if (
    !catalog ||
    catalog.format !== "bcr-research-volumes" ||
    catalog.version !== 1 ||
    !hash(catalog.researchHash) ||
    !Number.isSafeInteger(catalog.total) ||
    catalog.total < 1 ||
    catalog.total > 10000 ||
    !Array.isArray(catalog.books)
  )
    throw new Error("分卷目录无效");
  const ids = new Set<string>(),
    targets = new Set<string>(),
    hashes = new Map<string, number>(),
    volumes = new Set<number>();
  for (const entry of catalog.books) {
    if (
      !entry ||
      typeof entry.book !== "string" ||
      !entry.book ||
      ids.has(entry.book) ||
      typeof entry.target !== "string" ||
      !/^research-[a-f0-9]{64}$/u.test(entry.target) ||
      targets.has(entry.target) ||
      typeof entry.title !== "string" ||
      !hash(entry.hash) ||
      !Number.isSafeInteger(entry.volume) ||
      entry.volume < 1 ||
      entry.volume > catalog.total ||
      (hashes.has(entry.hash) && hashes.get(entry.hash) !== entry.volume)
    )
      throw new Error("分卷书籍映射无效");
    ids.add(entry.book);
    targets.add(entry.target);
    hashes.set(entry.hash, entry.volume);
    volumes.add(entry.volume);
  }
  if (volumes.size !== catalog.total && !(catalog.total === 1 && !catalog.books.length))
    throw new Error("分卷目录包含空卷");
  return catalog;
}

export function groupBooksByVolume<T extends { readonly volume: number }>(
  books: ReadonlyArray<T>,
): Map<number, T[]> {
  const grouped = new Map<number, T[]>();
  for (const book of books) {
    const group = grouped.get(book.volume);
    if (group) group.push(book);
    else grouped.set(book.volume, [book]);
  }
  return grouped;
}
type VolumeIdentity = Pick<ResearchVolumeBook, "book" | "target" | "hash">;
export function matchesVolumeBook(
  expected: VolumeIdentity,
  actual: VolumeIdentity | undefined,
): boolean {
  return (
    actual !== undefined &&
    expected.book === actual.book &&
    expected.target === actual.target &&
    expected.hash === actual.hash
  );
}
export type ResearchSourceState = "missing" | "repair" | "restored";
export interface ResearchSourceStatus extends ResearchVolumeBook {
  readonly state: ResearchSourceState;
  readonly restored: boolean;
}
export function sourceStatusLabel(book: ResearchSourceStatus): string {
  switch (book.state) {
    case "repair":
      return `需核对或修复 · 第 ${book.volume} 卷`;
    case "restored":
      return "已恢复";
    case "missing":
      return `待恢复第 ${book.volume} 卷`;
  }
}
export function sourceStatusCounts(
  books: ReadonlyArray<ResearchSourceStatus>,
): Record<ResearchSourceState, number> {
  const counts = { missing: 0, repair: 0, restored: 0 };
  for (const book of books) counts[book.state]++;
  return counts;
}
