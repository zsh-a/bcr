/**
 * Worker 物理资源池（架构文档 §5）。
 *
 * Worker 生命周期 ≠ Task 生命周期：任务取消只撤销自己的等待/执行，Worker 回池复用。
 * 弹性模式按 minSize 预热、按需扩到 maxSize，空闲超时后收缩。
 */

/** 最小 Worker 抽象，便于测试注入 fake。 */
export interface PoolWorker {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  addEventListener(type: "message", listener: (event: MessageEvent) => void): void;
  removeEventListener(type: "message", listener: (event: MessageEvent) => void): void;
  terminate(): void;
}

export interface WorkerPoolOptions {
  /** 常驻预热 Worker 数，至少 1。 */
  readonly minSize?: number | undefined;
  /** 并发高峰可扩到的上限。 */
  readonly maxSize: number;
  /** 超过 minSize 的空闲 Worker 在多久后回收。 */
  readonly idleTimeoutMs?: number | undefined;
}

export interface WorkerPoolSnapshot {
  readonly minSize: number;
  readonly maxSize: number;
  readonly size: number;
  readonly idle: number;
  readonly busy: number;
  readonly queued: number;
  readonly closed: boolean;
}

export class WorkerPoolClosed extends Error {
  override readonly name = "WorkerPoolClosed";

  constructor() {
    super("worker pool is closed");
  }
}

export class WorkerAcquireAborted extends Error {
  override readonly name = "WorkerAcquireAborted";

  constructor() {
    super("worker acquisition was aborted");
  }
}

interface Waiting {
  readonly resolve: (worker: PoolWorker) => void;
  readonly reject: (error: WorkerPoolClosed | WorkerAcquireAborted) => void;
  readonly signal?: AbortSignal | undefined;
  abortListener?: (() => void) | undefined;
}

const normalizeSize = (size: number): number =>
  Number.isFinite(size) ? Math.max(1, Math.floor(size)) : 1;

export class WorkerPool {
  private readonly idle: PoolWorker[] = [];
  private readonly waiting: Waiting[] = [];
  private readonly all = new Set<PoolWorker>();
  private readonly leased = new Set<PoolWorker>();
  private readonly idleTimers = new Map<PoolWorker, ReturnType<typeof setTimeout>>();
  private readonly minSize: number;
  private readonly maxSize: number;
  private readonly idleTimeoutMs: number;
  private closed = false;

  /** number 保持旧的固定池语义；options 开启 min/max 弹性池。 */
  constructor(
    sizeOrOptions: number | WorkerPoolOptions,
    private readonly factory: () => PoolWorker,
  ) {
    if (typeof sizeOrOptions === "number") {
      this.minSize = normalizeSize(sizeOrOptions);
      this.maxSize = this.minSize;
      this.idleTimeoutMs = 30_000;
    } else {
      this.minSize = normalizeSize(sizeOrOptions.minSize ?? 1);
      this.maxSize = Math.max(this.minSize, normalizeSize(sizeOrOptions.maxSize));
      const idleTimeoutMs = sizeOrOptions.idleTimeoutMs ?? 30_000;
      this.idleTimeoutMs = Number.isFinite(idleTimeoutMs) ? Math.max(0, idleTimeoutMs) : 30_000;
    }

    for (let i = 0; i < this.minSize; i += 1) this.idle.push(this.createWorker());
  }

  get size(): number {
    return this.all.size;
  }

  get snapshot(): WorkerPoolSnapshot {
    return {
      minSize: this.minSize,
      maxSize: this.maxSize,
      size: this.all.size,
      idle: this.idle.length,
      busy: this.leased.size,
      queued: this.waiting.length,
      closed: this.closed,
    };
  }

  private createWorker(): PoolWorker {
    const worker = this.factory();
    this.all.add(worker);
    return worker;
  }

  private clearIdleTimer(worker: PoolWorker): void {
    const timer = this.idleTimers.get(worker);
    if (timer === undefined) return;
    clearTimeout(timer);
    this.idleTimers.delete(worker);
  }

  private takeIdle(): PoolWorker | undefined {
    const worker = this.idle.shift();
    if (worker !== undefined) {
      this.clearIdleTimer(worker);
      this.leased.add(worker);
    }
    return worker;
  }

  private cleanupWaiter(waiter: Waiting): void {
    if (waiter.signal !== undefined && waiter.abortListener !== undefined) {
      waiter.signal.removeEventListener("abort", waiter.abortListener);
    }
  }

  /** idle-first；无空闲时按需扩容，达到 maxSize 后 FIFO 等待。 */
  acquire(signal?: AbortSignal): Promise<PoolWorker> {
    if (this.closed) return Promise.reject(new WorkerPoolClosed());
    if (signal?.aborted === true) return Promise.reject(new WorkerAcquireAborted());

    const idle = this.takeIdle();
    if (idle !== undefined) return Promise.resolve(idle);
    if (this.all.size < this.maxSize) {
      const worker = this.createWorker();
      this.leased.add(worker);
      return Promise.resolve(worker);
    }

    return new Promise((resolve, reject) => {
      const waiter: Waiting = { resolve, reject, signal };
      const abortListener = () => {
        const index = this.waiting.indexOf(waiter);
        if (index >= 0) this.waiting.splice(index, 1);
        this.cleanupWaiter(waiter);
        reject(new WorkerAcquireAborted());
      };
      waiter.abortListener = abortListener;
      this.waiting.push(waiter);
      signal?.addEventListener("abort", abortListener, { once: true });
    });
  }

  private park(worker: PoolWorker): void {
    if (this.idle.includes(worker)) return;
    this.idle.push(worker);
    if (this.all.size <= this.minSize) return;

    const timer = setTimeout(() => {
      this.idleTimers.delete(worker);
      const index = this.idle.indexOf(worker);
      if (index < 0 || this.all.size <= this.minSize) return;
      this.idle.splice(index, 1);
      this.all.delete(worker);
      worker.terminate();
    }, this.idleTimeoutMs);
    this.idleTimers.set(worker, timer);
  }

  release(worker: PoolWorker): void {
    if (this.closed || !this.all.has(worker) || !this.leased.delete(worker)) return;

    while (this.waiting.length > 0) {
      const waiter = this.waiting.shift();
      if (waiter === undefined) break;
      this.cleanupWaiter(waiter);
      if (waiter.signal?.aborted === true) {
        waiter.reject(new WorkerAcquireAborted());
        continue;
      }
      this.leased.add(worker);
      waiter.resolve(worker);
      return;
    }
    this.park(worker);
  }

  /** An interrupted task may still be computing; never reuse its Worker. */
  discard(worker: PoolWorker): void {
    if (!this.all.delete(worker)) return;
    this.leased.delete(worker);
    this.clearIdleTimer(worker);
    const index = this.idle.indexOf(worker);
    if (index >= 0) this.idle.splice(index, 1);
    worker.terminate();
    if (!this.closed && (this.all.size < this.minSize || this.waiting.length > 0)) {
      const replacement = this.createWorker();
      this.leased.add(replacement);
      this.release(replacement);
    }
  }

  /** 幂等关闭：终止全部 Worker，并让当前/未来等待者明确失败。 */
  shutdown(): void {
    if (this.closed) return;
    this.closed = true;
    for (const timer of this.idleTimers.values()) clearTimeout(timer);
    this.idleTimers.clear();
    for (const worker of this.all) worker.terminate();
    this.all.clear();
    this.leased.clear();
    this.idle.length = 0;

    for (const waiter of this.waiting.splice(0)) {
      this.cleanupWaiter(waiter);
      waiter.reject(new WorkerPoolClosed());
    }
  }
}

/** 默认峰值池大小：给主线程留一个核（主线程只负责 UI 与交互，§5）。 */
export function defaultPoolSize(): number {
  const concurrency = typeof navigator !== "undefined" ? (navigator.hardwareConcurrency ?? 2) : 2;
  return Math.max(1, concurrency - 1);
}
