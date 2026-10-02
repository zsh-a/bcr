import type { ArtifactRef } from "@bcr/core";
import type { TrendContextDecision, TrendResult } from "@bcr/quant-core/trend";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { readContextPage } from "../src/trend/results/read";

describe("trend background artifacts", () => {
  it("reads only the indexed chunks needed for one page, retaining decision order", async () => {
    const reads: string[] = [];
    const ref = (id: string): ArtifactRef => ({
      id,
      type: "quant/trend-chunk",
      hash: "a".repeat(64),
      storage: "opfs",
      format: "json",
    });
    const chunks = [100, 3, 4, 100].map((contexts, i) => ({
      ref: ref(String(i)),
      contexts,
      from: i,
      to: i + 1,
      trades: 0,
    }));
    const data = new Map([
      ["1", [100, 101, 102]],
      ["2", [103, 104, 105, 106]],
    ]);
    const services = {
      artifacts: {
        get: (artifact: ArtifactRef) =>
          Effect.sync(() => {
            reads.push(artifact.id);
            return new TextEncoder().encode(
              JSON.stringify({ contexts: data.get(artifact.id)?.map((time) => ({ time })) }),
            );
          }),
      },
    };
    const result = { chunks } as TrendResult;
    const page = await readContextPage(services, result, 34, 3, new AbortController().signal);
    expect(page.map((d) => d.time)).toEqual([102, 103, 104]);
    expect(reads).toEqual(["1", "2"]);
    const abort = new AbortController();
    abort.abort();
    await expect(readContextPage(services, result, 0, 3, abort.signal)).rejects.toThrow();
    expect(reads).toEqual(["1", "2"]);
  });
  it("does not read old chunks without background records", async () => {
    const result = { chunks: [{ trades: 1 }] } as TrendResult;
    const decisions: TrendContextDecision[] = await readContextPage(
      { artifacts: { get: () => Effect.die("unexpected artifact read") } },
      result,
      0,
      20,
      new AbortController().signal,
    );
    expect(decisions).toEqual([]);
  });
});
