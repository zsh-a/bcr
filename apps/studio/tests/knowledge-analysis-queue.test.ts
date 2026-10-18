import { describe, expect, it } from "vitest";
import { AnalysisQueue } from "../src/knowledge/notes/analysisQueue";
import { emptyMarkdownFacts } from "../src/knowledge/notes/markdownAnalysis";

const tick = () => new Promise<void>((resolve) => queueMicrotask(resolve));
describe("off-thread Markdown analysis scheduling", () => {
  it("shares a parse while allowing one consumer to cancel independently", async () => {
    let finish!: (value: typeof emptyMarkdownFacts) => void;
    let runs = 0;
    const queue = new AnalysisQueue(() => {
      runs++;
      return new Promise((resolve) => {
        finish = resolve;
      });
    });
    const controller = new AbortController();
    const canceled = queue.request("same input", controller.signal).catch(() => "aborted");
    const retained = queue.request("same input");
    await tick();
    await tick();
    controller.abort();
    finish(emptyMarkdownFacts);
    expect(await canceled).toBe("aborted");
    expect(await retained).toBe(emptyMarkdownFacts);
    expect(runs).toBe(1);
  });
  it("drops obsolete queued input and prioritizes current writing over cold backlinks", async () => {
    const calls: string[] = [];
    let finish!: (value: typeof emptyMarkdownFacts) => void;
    const queue = new AnalysisQueue((source) => {
      calls.push(source);
      return calls.length === 1
        ? new Promise((resolve) => {
            finish = resolve;
          })
        : Promise.resolve(emptyMarkdownFacts);
    });
    const first = queue.request("already running");
    await tick();
    await tick();
    const background = queue.request("cold note", undefined, true);
    const controller = new AbortController();
    const obsolete = queue.request("obsolete typing", controller.signal).catch(() => null);
    controller.abort();
    const latest = queue.request("latest typing");
    finish(emptyMarkdownFacts);
    await Promise.all([first, background, obsolete, latest]);
    expect(calls).toEqual(["already running", "latest typing", "cold note"]);
  });
  it("retries failed work and bounds cached snapshots", async () => {
    let runs = 0;
    const queue = new AnalysisQueue(async () => {
      if (++runs === 1) throw new Error("worker failed");
      return emptyMarkdownFacts;
    });
    await expect(queue.request("retry").catch(() => queue.request("retry"))).resolves.toBe(
      emptyMarkdownFacts,
    );
    for (const source of ["2", "3", "4", "5"]) await queue.request(source);
    const before = runs;
    await queue.request("5");
    expect(runs).toBe(before);
    await queue.request("retry");
    expect(runs).toBe(before + 1);
  });
});
