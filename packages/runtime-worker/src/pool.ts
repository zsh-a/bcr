/**
 * Worker 物理资源池（架构文档 §5）。
 *
 * Worker 生命周期 ≠ Task 生命周期：Worker 常驻复用、idle-first 分发；
 * 任务取消只是往对应 Worker 发 cancel 命令，不销毁 Worker。
 * 自动扩缩留待后续版本。
 */

/** 最小 Worker 抽象，便于测试注入 fake。 */
export interface PoolWorker {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  addEventListener(type: "message", listener: (event: MessageEvent) => void): void;
  removeEventListener(type: "message", listener: (event: MessageEvent) => void): void;
  terminate(): void;
}

export class WorkerPool {
  private readonly idle: PoolWorker[] = [];
  private readonly waiting: Array<(worker: PoolWorker) => void> = [];
  private readonly all: PoolWorker[] = [];

  constructor(size: number, factory: () => PoolWorker) {
    for (let i = 0; i < Math.max(1, size); i += 1) {
      const worker = factory();
      this.all.push(worker);
      this.idle.push(worker);
    }
  }

  get size(): number {
    return this.all.length;
  }

  /** idle-first 分发；无空闲则排队等待。 */
  acquire(): Promise<PoolWorker> {
    const worker = this.idle.shift();
    if (worker !== undefined) return Promise.resolve(worker);
    return new Promise((resolve) => {
      this.waiting.push(resolve);
    });
  }

  release(worker: PoolWorker): void {
    const resolve = this.waiting.shift();
    if (resolve !== undefined) {
      resolve(worker);
    } else {
      this.idle.push(worker);
    }
  }

  shutdown(): void {
    for (const worker of this.all) {
      worker.terminate();
    }
    this.all.length = 0;
    this.idle.length = 0;
    // 排队中的 acquire 永不 resolve 会让 fiber 挂起；池关闭即不再服务。
    this.waiting.length = 0;
  }
}

/** 默认池大小：给主线程留一个核（主线程只负责 UI 与交互，§5）。 */
export function defaultPoolSize(): number {
  const concurrency = typeof navigator !== "undefined" ? (navigator.hardwareConcurrency ?? 2) : 2;
  return Math.max(1, concurrency - 1);
}
