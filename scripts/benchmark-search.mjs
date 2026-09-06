/* Reproducible main-thread search benchmark against the actual Vite-served implementation.
 * Start bun run studio first. Optional: BCR_BENCH_SIZES=100,1000,5000 BASE_URL=... */
import assert from "node:assert/strict";
import { cpus, totalmem } from "node:os";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const origin = new URL(process.env.BASE_URL ?? "http://localhost:5199").origin;
const researchCorpus = process.env.BCR_BENCH_CORPUS === "research";
const sizes = (process.env.BCR_BENCH_SIZES ?? "100,1000,5000").split(",").map(Number);
assert.ok(
  sizes.length > 0 && sizes.every((size) => Number.isInteger(size) && size > 0 && size <= 50000),
);
const root = fileURLToPath(new URL("../", import.meta.url));
const browser = await chromium.launch({
  args: ["--disable-dev-shm-usage", "--enable-precise-memory-info"],
});
const rows = [];
try {
  for (const size of sizes) {
    const context = await browser.newContext();
    const page = await context.newPage();
    // An empty same-origin page keeps application boot/rendering out of the measurement.
    await page.route("**/__search_benchmark__", (route) =>
      route.fulfill({
        contentType: "text/html",
        body: "<!doctype html><title>Search benchmark</title>",
      }),
    );
    await page.goto(`${origin}/__search_benchmark__`);
    const result = await page.evaluate(
      async ({ size, root, researchCorpus }) => {
        const { createSearchIndex } = await import(`/@fs/${root}packages/core/src/search.ts`);
        const { textVersion } = await import(`/@fs/${root}packages/core/src/citation.ts`);
        const pause = () => new Promise((resolve) => setTimeout(resolve, 0));
        const heap = () => performance.memory?.usedJSHeapSize ?? null;
        const beforeHeap = heap();
        let persisted;
        const index = createSearchIndex({
          load: async () => undefined,
          save: async (raw) => {
            persisted = raw;
          },
        });
        await index.ready;
        let documents = Array.from({ length: size }, (_, i) => {
          const body =
            `${i % 2 ? "分布式系统与本地资料研究。" : "Local research and distributed systems. "}`.repeat(
              18,
            ) +
            (i % 97 === 0 ? " 唯一研究证据 rare-evidence " : "") +
            ` record-${i}`;
          return {
            id: `bench:${i}`,
            source: "bench",
            kind: "reader-section",
            title: `Chapter ${i} 研究章节`,
            body,
            route: `/reader?book=bench&section=${i}`,
            updatedAt: i,
            citation: { scope: `bench:${i}`, version: textVersion(body), unit: `${i}`, offset: 0 },
          };
        });
        if (researchCorpus) {
          const { researchDocuments } = await import(
            `/@fs/${root}apps/studio/src/researchSearch.ts`
          );
          documents = researchDocuments({
            version: 1,
            collections: [
              {
                id: "benchmark",
                name: "研究基准",
                excerpts: documents.slice(0, Math.ceil(size / 2)).map((item, i) => ({
                  id: item.id,
                  documentId: item.id,
                  title: item.title,
                  source: "Reader",
                  route: item.route,
                  text: item.body,
                  note: `个人理解 ${item.body}`,
                  draft: "不会进入索引的草稿",
                  savedAt: i,
                })),
              },
            ],
          }).slice(0, size);
        }
        const corpusBytes = new TextEncoder().encode(JSON.stringify(documents)).byteLength;
        const buildStart = performance.now();
        index.replaceSource("bench", documents);
        const buildMs = performance.now() - buildStart;
        await index.flush(); // Remove background serialization from the measured query phase.
        await index.close();
        const queries = [
          researchCorpus ? "个人理解" : "唯一研究证据",
          "rare-evidence",
          "distributed systems",
          "不存在的检索词",
        ];
        for (const query of queries) index.search(query, { limit: 60 });
        await pause();
        const longTasks = [];
        const observer = new PerformanceObserver((list) =>
          longTasks.push(...list.getEntries().map((entry) => entry.duration)),
        );
        observer.observe({ type: "longtask" });
        const samples = [];
        const byQuery = [];
        for (const query of queries) {
          const times = [];
          let hits = 0;
          for (let round = 0; round < 5; round++) {
            await pause();
            const start = performance.now();
            hits = index.search(query, { limit: 60 }).length;
            const elapsed = performance.now() - start;
            times.push(elapsed);
            samples.push(elapsed);
          }
          times.sort((a, b) => a - b);
          byQuery.push({ query, hits, p50Ms: times[2], p95Ms: times[4] });
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
        longTasks.push(...observer.takeRecords().map((entry) => entry.duration));
        observer.disconnect();
        const serializeStart = performance.now();
        await index.flush();
        const serializeMs = performance.now() - serializeStart;
        const restoreStart = performance.now();
        const restored = createSearchIndex({ load: async () => persisted, save: async () => {} });
        await restored.ready;
        const restoreMs = performance.now() - restoreStart;
        const restoredCount = restored.documents().length;
        const afterHeap = heap();
        samples.sort((a, b) => a - b);
        return {
          documents: size,
          restoredCount,
          corpusBytes,
          buildMs,
          serializeMs,
          restoreMs,
          p50Ms: samples[Math.floor(samples.length * 0.5)],
          p95Ms: samples[Math.ceil(samples.length * 0.95) - 1],
          queryLongTasks: longTasks.length,
          longestTaskMs: Math.max(0, ...longTasks),
          heapDeltaBytes: beforeHeap === null || afterHeap === null ? null : afterHeap - beforeHeap,
          persistedBytes: new TextEncoder().encode(persisted).byteLength,
          byQuery,
        };
      },
      { size, root, researchCorpus },
    );
    assert.equal(result.restoredCount, size);
    assert.equal(result.byQuery.at(-1).hits, 0);
    assert.ok(result.byQuery[0].hits > 0 && result.byQuery[1].hits > 0);
    rows.push(result);
    console.log(
      `Search ${size}: p50=${result.p50Ms.toFixed(1)}ms p95=${result.p95Ms.toFixed(1)}ms longTasks=${result.queryLongTasks}`,
    );
    await context.close();
  }
  const report = {
    corpus: researchCorpus ? "saved research notes and excerpts" : "reader projections",
    recordedAt: new Date().toISOString(),
    browser: browser.version(),
    platform: process.platform,
    arch: process.arch,
    cpu: cpus()[0]?.model,
    logicalCpus: cpus().length,
    systemMemoryBytes: totalmem(),
    mode: "Vite development modules; synthetic main-thread corpus; in-memory persistence; 1 warm-up + 5 measured queries per case",
    rows,
  };
  const output = new URL(
    researchCorpus ? "./shots/search-benchmark-research.json" : "./shots/search-benchmark.json",
    import.meta.url,
  );
  await mkdir(new URL("./shots/", import.meta.url), { recursive: true });
  await writeFile(output, JSON.stringify(report, null, 2));
  console.log(`Report: ${fileURLToPath(output)}`);
} finally {
  await browser.close();
}
