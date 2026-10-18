import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSearchIndex, type SearchDocument } from "@bcr/core";

const catalog = vi.hoisted(() => vi.fn());
vi.mock("../src/search/marketDocuments", () => ({ marketDocuments: catalog }));
const document: SearchDocument = {
  id: "market:CN:SSE:000300",
  source: "market",
  kind: "market-instrument",
  title: "沪深300",
  body: "CSI 300 指数",
  route: "/markets?instrument=CN%3ASSE%3A000300",
  updatedAt: 0,
};

beforeEach(() => {
  vi.resetModules();
  catalog.mockReset().mockReturnValue([document]);
});

describe("deferred immutable market catalog", () => {
  it("loads on demand and publishes only once per index, including concurrent requests", async () => {
    const { prepareMarketSearch } = await import("../src/search/marketSearch");
    expect(catalog).not.toHaveBeenCalled();
    const search = createSearchIndex(),
      publish = vi.spyOn(search, "replaceSource");
    const first = prepareMarketSearch(search);
    expect(prepareMarketSearch(search)).toBe(first);
    await first;
    const entry = search.documents()[0];
    await prepareMarketSearch(search);
    expect(catalog).toHaveBeenCalledTimes(1);
    expect(publish).toHaveBeenCalledTimes(1);
    expect(search.documents()[0]).toBe(entry);
    expect(search.search("CSI")[0]?.document.route).toBe(document.route);
    const second = createSearchIndex();
    await prepareMarketSearch(second);
    expect(catalog).toHaveBeenCalledTimes(1);
    expect(second.search("沪深300")[0]?.document.id).toBe(document.id);
    await Promise.all([search.close(), second.close()]);
  });

  it("waits for restored search data before replacing stale persisted market entries", async () => {
    const { prepareMarketSearch } = await import("../src/search/marketSearch");
    let restore: (value: string | undefined) => void = () => {};
    const search = createSearchIndex({
      load: () => new Promise((resolve) => (restore = resolve)),
      save: async () => {},
    });
    const publish = vi.spyOn(search, "replaceSource");
    const ready = prepareMarketSearch(search);
    await vi.waitFor(() => expect(catalog).toHaveBeenCalledTimes(1));
    expect(publish).not.toHaveBeenCalled();
    restore(JSON.stringify({ version: 1, documents: [{ ...document, id: "stale" }] }));
    await ready;
    expect(search.documents().map((item) => item.id)).toEqual([document.id]);
    await search.close();
  });

  it("allows retry after a failed lazy load while preserving other search sources", async () => {
    const { prepareMarketSearch } = await import("../src/search/marketSearch");
    catalog.mockImplementationOnce(() => {
      throw new Error("chunk download interrupted");
    });
    const search = createSearchIndex();
    await search.ready;
    search.upsert({ ...document, id: "knowledge:note", source: "knowledge", title: "笔记" });
    await expect(prepareMarketSearch(search)).rejects.toThrow("interrupted");
    expect(search.documents().map((item) => item.id)).toEqual(["knowledge:note"]);
    await prepareMarketSearch(search);
    expect(catalog).toHaveBeenCalledTimes(2);
    expect(
      search
        .documents()
        .map((item) => item.id)
        .sort(),
    ).toEqual(["knowledge:note", document.id]);
    await search.close();
  });
});
