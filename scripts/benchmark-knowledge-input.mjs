import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";

// Run against a production preview for comparisons; each run uses isolated storage.
const origin = new URL(process.env.BASE_URL ?? "http://127.0.0.1:5199").origin;
const output = process.env.OUTPUT_JSON ?? "/tmp/bcr-knowledge-input.json";
const sourceHash = createHash("sha256").update(execFileSync("git", ["diff", "HEAD", "--binary"]));
for (const path of execFileSync(
  "git",
  ["ls-files", "--others", "--exclude-standard", "--", "apps/studio/src", "scripts"],
  { encoding: "utf8" },
)
  .trim()
  .split("\n")
  .filter(Boolean)
  .sort())
  sourceHash.update(path).update(readFileSync(path));
const median = (items) => [...items].sort((a, b) => a - b)[Math.floor(items.length / 2)];
const rich =
  "# 标题\n\n中文🙂 **重点** 与 [[note|别名]] [外链](https://example.com)\n\n![图](attachment:picture)\n\n```js\nconst value = 42;\n```\n\n";
const plain = "这是一段普通的中文文字，用于测量长文输入。\n\n";
const browser = await chromium.launch();
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
    serviceWorkers: "block",
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${origin}/knowledge`);
  await page.getByRole("button", { name: "新建笔记", exact: true }).click();
  await page.getByLabel("笔记正文", { exact: true }).waitFor();
  await page.evaluate(() => {
    // Benchmark instrumentation only. No production code depends on this internal DOM property.
    const view = document.querySelector(".cm-content").cmTile?.root?.view;
    if (!view) throw new Error("Cannot locate benchmark editor; update the CodeMirror adapter");
    window.__inputBenchmark = { view, transactions: [], longTasks: [] };
    const original = view.dispatch.bind(view);
    view.dispatch = (...args) => {
      const previous = view.state.doc,
        start = performance.now();
      try {
        return original(...args);
      } finally {
        if (previous !== view.state.doc)
          window.__inputBenchmark.transactions.push(performance.now() - start);
      }
    };
    new PerformanceObserver((list) => {
      window.__inputBenchmark.longTasks.push(...list.getEntries().map((entry) => entry.duration));
    }).observe({ type: "longtask" });
  });
  const results = [];
  for (const [label, size, paragraph] of [
    ["rich-2k", 2000, rich],
    ["rich-50k", 50_000, rich],
    ["rich-150k", 150_000, rich],
    ["rich-400k", 400_000, rich],
    ["plain-150k", 150_000, plain],
  ]) {
    const source = paragraph.repeat(Math.ceil(size / paragraph.length)).slice(0, size);
    await page.evaluate((source) => {
      const { view } = window.__inputBenchmark;
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: source },
        selection: { anchor: source.length },
        scrollIntoView: true,
      });
      view.focus();
    }, source);
    await page.waitForTimeout(2000);
    await page.evaluate(() => {
      window.__inputBenchmark.transactions = [];
      window.__inputBenchmark.longTasks = [];
    });
    const roundTrips = [];
    for (let i = 0; i < 7; i++) {
      const start = performance.now();
      await page.keyboard.type("x");
      roundTrips.push(performance.now() - start);
      await page.evaluate(
        () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
      );
    }
    await page.waitForTimeout(1000);
    const result = await page.evaluate(() => {
      const { view, transactions, longTasks } = window.__inputBenchmark;
      return {
        transactions,
        longTasks,
        documentLength: view.state.doc.length,
        renderedLines: document.querySelectorAll(".cm-line").length,
      };
    });
    assert.equal(result.documentLength, size + 7);
    assert.equal(result.transactions.length, 7);
    results.push({
      label,
      fixtureSha256: createHash("sha256").update(source).digest("hex"),
      ...result,
      transactionMedianMs: median(result.transactions),
      playwrightRoundTripMedianMs: median(roundTrips),
    });
    console.log(JSON.stringify(results.at(-1)));
  }
  assert.deepEqual(errors, []);
  writeFileSync(
    output,
    JSON.stringify(
      {
        head: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
        sourceDiffSha256: sourceHash.digest("hex"),
        origin,
        cpuThrottling: 1,
        results,
      },
      null,
      2,
    ),
  );
} finally {
  await browser.close();
}
