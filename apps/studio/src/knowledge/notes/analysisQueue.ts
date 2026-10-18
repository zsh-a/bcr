import type { MarkdownFacts } from "./markdownAnalysis";

type Listener = { resolve: (value: MarkdownFacts) => void; reject: (reason: unknown) => void };
type Job = { source: string; priority: number; listeners: Set<Listener> };

/** One active parse; obsolete queued inputs are removed before reaching the worker. */
export class AnalysisQueue {
  private jobs = new Map<string, Job>();
  private cache = new Map<string, MarkdownFacts>();
  private active: Job | null = null;
  constructor(private run: (source: string) => Promise<MarkdownFacts>) {}

  request(source: string, signal?: AbortSignal, background = false): Promise<MarkdownFacts> {
    if (signal?.aborted) return Promise.reject(signal.reason);
    const cached = this.cache.get(source);
    if (cached) return Promise.resolve(cached);
    let job = this.jobs.get(source);
    if (!job) {
      job = { source, priority: background ? 0 : 1, listeners: new Set() };
      this.jobs.set(source, job);
    } else if (!background) job.priority = 1;
    const current = job;
    return new Promise((resolve, reject) => {
      const clean = () => signal?.removeEventListener("abort", abort);
      const listener: Listener = {
        resolve: (value) => {
          clean();
          resolve(value);
        },
        reject: (reason) => {
          clean();
          reject(reason);
        },
      };
      const abort = () => {
        current.listeners.delete(listener);
        if (!current.listeners.size && current !== this.active) this.jobs.delete(source);
        listener.reject(signal?.reason);
      };
      current.listeners.add(listener);
      signal?.addEventListener("abort", abort, { once: true });
      queueMicrotask(() => this.pump());
    });
  }

  private pump() {
    if (this.active) return;
    const job =
      [...this.jobs.values()].find((item) => item.priority === 1) ??
      this.jobs.values().next().value;
    if (!job) return;
    this.active = job;
    void Promise.resolve()
      .then(() => this.run(job.source))
      .then(
        (facts) => {
          this.cache.delete(job.source);
          this.cache.set(job.source, facts);
          while (this.cache.size > 4) this.cache.delete(this.cache.keys().next().value!);
          this.finish(job);
          for (const listener of job.listeners) listener.resolve(facts);
          queueMicrotask(() => this.pump());
        },
        (reason) => {
          this.finish(job);
          for (const listener of job.listeners) listener.reject(reason);
          queueMicrotask(() => this.pump());
        },
      );
  }
  private finish(job: Job) {
    this.jobs.delete(job.source);
    this.active = null;
  }
}
