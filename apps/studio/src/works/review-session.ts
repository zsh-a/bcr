import {
  emptyReviewBook,
  type Job,
  type ReviewAction,
  type ReviewBook,
  type WorkRef,
} from "@bcr/work-core";
import type { WorkService } from "./service";

type State = { book: ReviewBook; jobs: Job[]; loading: boolean; busy: boolean; error: string };
export class ReviewSession {
  private state: State = {
    book: emptyReviewBook(),
    jobs: [],
    loading: true,
    busy: false,
    error: "",
  };
  private listeners = new Set<() => void>();
  private abort = new AbortController();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private generation = 0;
  constructor(
    readonly service: WorkService,
    readonly ref: WorkRef,
  ) {}
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private patch(next: Partial<State>) {
    if (!this.abort.signal.aborted) {
      this.state = { ...this.state, ...next };
      for (const listener of this.listeners) listener();
    }
  }
  start() {
    this.abort = new AbortController();
    const signal = this.abort.signal;
    const poll = async () => {
      try {
        await this.refresh(signal);
      } catch (e) {
        if (!signal.aborted) this.patch({ error: String(e), loading: false });
      } finally {
        if (!signal.aborted) this.timer = setTimeout(() => void poll(), 3000);
      }
    };
    void poll();
    return () => {
      this.abort.abort();
      clearTimeout(this.timer);
    };
  }
  async refresh(signal = this.abort.signal) {
    const generation = this.generation;
    const [book, jobs] = await Promise.all([
      this.service.reviewRead(this.ref, signal),
      this.service.call<Job[]>(this.ref.sourceId, "jobs", { id: this.ref.id }, signal),
    ]);
    if (!signal.aborted)
      this.patch({ ...(generation === this.generation ? { book } : {}), jobs, loading: false });
  }
  async edit(action: ReviewAction) {
    this.generation++;
    const book = await this.service.reviewEdit(
      this.ref,
      {
        id: this.ref.id,
        revision: this.state.book.revision,
        requestId: crypto.randomUUID(),
        action,
      },
      this.abort.signal,
    );
    this.generation++;
    this.patch({ book });
    return book;
  }
  async run(action: () => Promise<unknown>) {
    if (this.state.busy) return false;
    const signal = this.abort.signal;
    this.patch({ busy: true, error: "" });
    try {
      await action();
      return !signal.aborted;
    } catch (error) {
      if (!signal.aborted) {
        this.patch({ error: error instanceof Error ? error.message : String(error) });
        await this.refresh(signal).catch(() => undefined);
      }
      return false;
    } finally {
      if (!signal.aborted) this.patch({ busy: false });
    }
  }
}
export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob),
    anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
