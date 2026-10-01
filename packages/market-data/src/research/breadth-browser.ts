import type { ResearchDataset } from "./model";
export interface BreadthDay {
  date: string;
  breadth: { industry: string; above: number; total: number; ratio: number }[];
}
export function calculateMarketBreadth(
  dataset: ResearchDataset,
  signal: AbortSignal,
  progress: (done: number) => void,
): Promise<BreadthDay[]> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("../workers/breadth.worker.ts", import.meta.url), {
      type: "module",
    });
    const cleanup = () => {
      signal.removeEventListener("abort", cancel);
      worker.terminate();
    };
    const cancel = () => {
      cleanup();
      reject(new DOMException("计算已取消", "AbortError"));
    };
    signal.addEventListener("abort", cancel, { once: true });
    worker.onerror = () => {
      cleanup();
      reject(new Error("宽度计算 Worker 启动失败"));
    };
    worker.onmessage = (
      event: MessageEvent<
        | { type: "progress"; done: number }
        | { type: "result"; days: BreadthDay[] }
        | { type: "error"; error: string }
      >,
    ) => {
      const m = event.data;
      if (m.type === "progress") {
        progress(m.done);
        return;
      }
      cleanup();
      if (m.type === "error") reject(new Error(m.error));
      else resolve(m.days);
    };
    worker.postMessage(dataset);
  });
}
