import { describe, expect, it } from "vitest";
import { decodeVolumeCatalog, type ResearchVolumeCatalog } from "../src/researchVolumes";
const catalog: ResearchVolumeCatalog = {
  format: "bcr-research-volumes",
  version: 1,
  researchHash: "a".repeat(64),
  total: 2,
  books: [1, 2].map((volume) => ({
    book: `book-${volume}`,
    target: `research-${String(volume).repeat(64)}`,
    title: `Book ${volume}`,
    hash: String(volume).repeat(64),
    volume,
  })),
};
describe("research volume directory validation", () => {
  it("accepts complete directories and an independent collection-only volume", () => {
    expect(decodeVolumeCatalog(catalog)).toEqual(catalog);
    expect(decodeVolumeCatalog({ ...catalog, total: 1, books: [] }).books).toEqual([]);
  });
  it("rejects ambiguous identities, shared sources split across volumes and missing volumes", () => {
    const [first, second] = catalog.books;
    for (const books of [
      [first, { ...second, book: first!.book }],
      [first, { ...second, target: first!.target }],
      [first, { ...second, hash: first!.hash }],
      [first],
      [first, { ...second, volume: 3 }],
    ])
      expect(() => decodeVolumeCatalog({ ...catalog, books })).toThrow();
    for (const total of [0, -1, 1.5, 10001])
      expect(() => decodeVolumeCatalog({ ...catalog, total })).toThrow();
  });
});
