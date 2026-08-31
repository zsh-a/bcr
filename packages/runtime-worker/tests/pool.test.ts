import { describe, expect, it } from "vitest";
import { WorkerAcquireAborted, WorkerPool, WorkerPoolClosed, type PoolWorker } from "../src/pool";

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
    pool.release(a); // 幂等：重复归还不能把同一 Worker 放进池两次
    const c = await pool.acquire();
    expect(c).toBe(a);
    expect(pool.snapshot).toMatchObject({ size: 2, idle: 0, busy: 2 });
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

  it("等待 acquire 可取消，取消项不会吞掉归还的 Worker", async () => {
    const pool = new WorkerPool(1, () => new FakeWorker());
    const held = await pool.acquire();
    const controller = new AbortController();
    const pending = pool.acquire(controller.signal);
    expect(pool.snapshot.queued).toBe(1);

    controller.abort();
    await expect(pending).rejects.toBeInstanceOf(WorkerAcquireAborted);
    expect(pool.snapshot.queued).toBe(0);

    pool.release(held);
    expect(await pool.acquire()).toBe(held);
    pool.shutdown();
  });

  it("弹性池按需扩容，空闲超时后收缩到 minSize", async () => {
    const workers: FakeWorker[] = [];
    const pool = new WorkerPool({ minSize: 1, maxSize: 3, idleTimeoutMs: 10 }, () => {
      const w = new FakeWorker();
      workers.push(w);
      return w;
    });

    expect(pool.snapshot).toMatchObject({ size: 1, idle: 1, busy: 0, queued: 0 });
    const a = await pool.acquire();
    const b = await pool.acquire();
    const c = await pool.acquire();
    expect(pool.snapshot).toMatchObject({ size: 3, idle: 0, busy: 3 });

    pool.release(a);
    pool.release(b);
    pool.release(c);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(pool.snapshot).toMatchObject({ size: 1, idle: 1, busy: 0 });
    expect(workers.filter(({ terminated }) => terminated)).toHaveLength(2);
    pool.shutdown();
    expect(workers.every((w) => w.terminated)).toBe(true);
  });

  it("shutdown 终止 Worker、拒绝排队项和未来 acquire", async () => {
    const workers: FakeWorker[] = [];
    const pool = new WorkerPool(1, () => {
      const worker = new FakeWorker();
      workers.push(worker);
      return worker;
    });
    await pool.acquire();
    const pending = pool.acquire();

    pool.shutdown();
    pool.shutdown();

    await expect(pending).rejects.toBeInstanceOf(WorkerPoolClosed);
    await expect(pool.acquire()).rejects.toBeInstanceOf(WorkerPoolClosed);
    expect(pool.snapshot).toMatchObject({ size: 0, idle: 0, busy: 0, queued: 0, closed: true });
    expect(workers.every((w) => w.terminated)).toBe(true);
  });
});
