import { describe, expect, it } from "vitest";
import { WorkerPool, type PoolWorker } from "../src/pool";

class FakeWorker implements PoolWorker {
  terminated = false;
  messages: unknown[] = [];
  postMessage(message: unknown): void {
    this.messages.push(message);
  }
  addEventListener(): void {}
  removeEventListener(): void {}
  terminate(): void {
    this.terminated = true;
  }
}

describe("WorkerPool (架构 §5)", () => {
  it("idle-first 分发并复用", async () => {
    const created: FakeWorker[] = [];
    const pool = new WorkerPool(2, () => {
      const w = new FakeWorker();
      created.push(w);
      return w;
    });

    const a = await pool.acquire();
    const b = await pool.acquire();
    expect(a).not.toBe(b);
    expect(created).toHaveLength(2);

    pool.release(a);
    const c = await pool.acquire();
    expect(c).toBe(a);
    pool.shutdown();
  });

  it("无空闲时排队，release 唤醒等待者", async () => {
    const pool = new WorkerPool(1, () => new FakeWorker());
    const a = await pool.acquire();

    let resolved = false;
    const pending = pool.acquire().then((w) => {
      resolved = true;
      return w;
    });

    await new Promise((r) => setTimeout(r, 10));
    expect(resolved).toBe(false);

    pool.release(a);
    const b = await pending;
    expect(b).toBe(a);
    pool.shutdown();
  });

  it("shutdown 终止全部 Worker", async () => {
    const workers: FakeWorker[] = [];
    const pool = new WorkerPool(2, () => {
      const w = new FakeWorker();
      workers.push(w);
      return w;
    });
    await pool.acquire();
    pool.shutdown();
    expect(workers.every((w) => w.terminated)).toBe(true);
  });
});
