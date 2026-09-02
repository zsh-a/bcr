import { describe, expect, it } from "vitest";
import { MangaStore } from "../src/store";

describe("manga batch checkpoints", () => {
  it("retries a failed queue while preserving completed pages", () => {
    const store = new MangaStore();
    store.startBatch(["page-a", "page-b"], false);
    store.completeBatchPage("page-a");
    const batch = store.getSnapshot().batch;
    expect(batch).not.toBeUndefined();
    store.failBatch("page-b failed");
    store.startBatch(["page-a", "page-b"], true);
    expect(store.getSnapshot().batch).toMatchObject({
      id: batch?.id,
      status: "running",
      completedPageIds: ["page-a"],
    });
  });
});
