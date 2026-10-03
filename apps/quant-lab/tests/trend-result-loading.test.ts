import type { TrendResult } from "@bcr/quant-core/trend";
import { describe, expect, it } from "vitest";
import {
  createTrendResultLoader,
  selectedTrendResult,
  type TrendResultSelection,
} from "../src/trend/session/result";

const selection = (id: string, hash = id): TrendResultSelection => ({
  id,
  resultRef: { id: `result/${id}`, hash, storage: "opfs", type: "quant/trend-result" },
});
// These tests exercise read identity and lifecycle; result payloads are opaque to the loader.
const payload = (totalReturn: number) => ({ metrics: { totalReturn } }) as TrendResult;
function deferred() {
  let resolve!: (result: TrendResult) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<TrendResult>((accept, fail) => {
    resolve = accept;
    reject = fail;
  });
  return { promise, resolve, reject };
}

describe("selected trend result loading", () => {
  it("hides the previous run synchronously before the next selection's loading effect", async () => {
    const loader = createTrendResultLoader(async () => payload(0.12));
    const a = selection("a"),
      b = selection("b");
    await loader.load(a);
    expect(selectedTrendResult(loader.getSnapshot(), a).status).toBe("ready");
    expect(selectedTrendResult(loader.getSnapshot(), b)).toEqual({
      status: "loading",
      runId: "b",
      resultRef: b.resultRef,
    });
    expect(selectedTrendResult(loader.getSnapshot(), null)).toEqual({ status: "idle" });
    expect(selectedTrendResult(loader.getSnapshot(), structuredClone(a)).status).toBe("ready");
    expect(selectedTrendResult(loader.getSnapshot(), selection("a", "new-content")).status).toBe(
      "loading",
    );
  });

  it("keeps the newest result when an older read finishes last", async () => {
    const a = deferred(),
      b = deferred();
    const loader = createTrendResultLoader((ref) =>
      ref.id === "result/a" ? a.promise : b.promise,
    );
    const first = loader.load(selection("a"));
    const second = loader.load(selection("b"));
    b.resolve(payload(0.2));
    await second;
    a.resolve(payload(-0.4));
    await first;
    expect(loader.getSnapshot()).toMatchObject({
      status: "ready",
      runId: "b",
      result: { metrics: { totalReturn: 0.2 } },
    });
  });

  it("scopes errors to their run, ignores obsolete failures, and supports retry", async () => {
    const old = deferred();
    let failed = true;
    const loader = createTrendResultLoader((ref) => {
      if (ref.id === "result/a") return old.promise;
      return failed ? Promise.reject(new Error("missing artifact")) : Promise.resolve(payload(0.3));
    });
    const first = loader.load(selection("a"));
    await loader.load(selection("b"));
    expect(loader.getSnapshot()).toMatchObject({ status: "error", runId: "b" });
    expect(selectedTrendResult(loader.getSnapshot(), selection("c")).status).toBe("loading");
    failed = false;
    await loader.load(selection("b"));
    old.reject(new Error("obsolete failure"));
    await first;
    expect(loader.getSnapshot()).toMatchObject({ status: "ready", runId: "b" });
  });

  it("does not publish after cleanup and permits React's repeated loading effects", async () => {
    const first = deferred(),
      second = deferred();
    let calls = 0;
    const loader = createTrendResultLoader(() => (++calls === 1 ? first.promise : second.promise));
    let updates = 0;
    const unsubscribe = loader.subscribe(() => updates++);
    const old = loader.load(selection("a"));
    loader.cancel();
    const current = loader.load(selection("a"));
    first.resolve(payload(-0.1));
    await old;
    expect(loader.getSnapshot().status).toBe("loading");
    second.resolve(payload(0.1));
    await current;
    expect(loader.getSnapshot()).toMatchObject({
      status: "ready",
      result: { metrics: { totalReturn: 0.1 } },
    });
    expect(updates).toBe(3);
    unsubscribe();
    await loader.load(null);
    expect(loader.getSnapshot()).toEqual({ status: "idle" });
    expect(updates).toBe(3);
  });
});
