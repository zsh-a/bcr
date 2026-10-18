import { AnalysisQueue } from "./analysisQueue";
import {
  cachedMarkdownFacts,
  markdownFacts,
  rememberMarkdownFacts,
  type MarkdownFacts,
} from "./markdownAnalysis";

let worker: Worker | null = null;
let unavailable = false;
let sequence = 0;

async function parse(source: string): Promise<MarkdownFacts> {
  const cached = cachedMarkdownFacts(source);
  if (cached) return cached;
  if (!unavailable && typeof Worker !== "undefined") {
    try {
      worker ??= new Worker(new URL("./markdownAnalysis.worker.ts", import.meta.url), {
        type: "module",
      });
      const active = worker,
        id = ++sequence;
      const facts = await new Promise<MarkdownFacts>((resolve, reject) => {
        const cleanup = () => {
          clearTimeout(timer);
          active.removeEventListener("message", message);
          active.removeEventListener("error", error);
          active.removeEventListener("messageerror", error);
        };
        const message = (
          event: MessageEvent<{ id: number; facts?: MarkdownFacts; error?: string }>,
        ) => {
          if (event.data.id !== id) return;
          cleanup();
          if (event.data.facts) resolve(event.data.facts);
          else reject(new Error(event.data.error ?? "笔记分析失败"));
        };
        const error = () => {
          cleanup();
          reject(new Error("笔记分析线程不可用"));
        };
        const timer = setTimeout(error, 30_000);
        active.addEventListener("message", message);
        active.addEventListener("error", error);
        active.addEventListener("messageerror", error);
        active.postMessage({ id, source });
      });
      return rememberMarkdownFacts(source, facts);
    } catch {
      worker?.terminate();
      worker = null;
      unavailable = true;
    }
  }
  // Restricted browsers keep correct analysis, scheduled outside the input transaction.
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  return markdownFacts(source);
}

const queue = new AnalysisQueue(parse);
export function analyzeMarkdownAsync(source: string, signal?: AbortSignal, background = false) {
  return queue.request(source, signal, background);
}
