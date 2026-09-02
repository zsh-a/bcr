import { useSyncExternalStore } from "react";
import type { RuntimeMetadata } from "@bcr/react";
import {
  createDocumentJob,
  markReadyStages,
  type DocumentFormat,
  type DocumentJob,
  type DocumentStageId,
} from "@bcr/document-core";

export interface DocumentState {
  readonly jobs: ReadonlyArray<DocumentJob>;
  readonly activeJobId: string;
  readonly selectedStageId: DocumentStageId;
  readonly notice: string | null;
}

const STORAGE_KEY = "bcr.document-studio.v1";
const METADATA_KEY = "document-studio.jobs.v1";

function demoJob(): DocumentJob {
  return markReadyStages(
    createDocumentJob({
      id: "document-demo-atlas",
      name: "the-atlas-of-small-things.epub",
      format: "epub",
      size: 4_800_000,
      sourceTextPreview: "一份等待进入 Reader 的 EPUB 出版物。",
      now: Date.now(),
    }),
  );
}

function isFormat(value: unknown): value is DocumentFormat {
  return (
    value === "txt" ||
    value === "markdown" ||
    value === "html" ||
    value === "docx" ||
    value === "fb2" ||
    value === "epub" ||
    value === "pdf" ||
    value === "cbz" ||
    value === "image" ||
    value === "unknown"
  );
}

function parseJobs(raw: string | null): ReadonlyArray<DocumentJob> {
  if (raw === null) return [demoJob()];
  try {
    const parsed = JSON.parse(raw) as { jobs?: unknown };
    if (!Array.isArray(parsed.jobs) || parsed.jobs.length === 0) return [demoJob()];
    const jobs = parsed.jobs.filter((value): value is DocumentJob => {
      if (typeof value !== "object" || value === null) return false;
      const candidate = value as {
        id?: unknown;
        name?: unknown;
        format?: unknown;
        stages?: unknown;
      };
      return (
        typeof candidate.id === "string" &&
        typeof candidate.name === "string" &&
        isFormat(candidate.format) &&
        Array.isArray(candidate.stages)
      );
    });
    return jobs.length > 0 ? jobs : [demoJob()];
  } catch {
    return [demoJob()];
  }
}

function serializedJobs(jobs: ReadonlyArray<DocumentJob>): ReadonlyArray<DocumentJob> {
  return jobs.map((job) => {
    // Object URLs and File handles are tab-local; never serialize stale URLs.
    const persisted = { ...job };
    delete (persisted as { sourceUrl?: string }).sourceUrl;
    return persisted;
  });
}

function restoreJobs(): ReadonlyArray<DocumentJob> {
  if (typeof localStorage === "undefined") return [demoJob()];
  return parseJobs(localStorage.getItem(STORAGE_KEY));
}

function initialState(): DocumentState {
  const jobs = restoreJobs();
  const active = jobs[0] ?? demoJob();
  return {
    jobs,
    activeJobId: active.id,
    selectedStageId: active.stages[0]?.id ?? "ingest",
    notice: null,
  };
}

class DocumentStore {
  private state = initialState();
  private readonly listeners = new Set<() => void>();
  private readonly sourceFiles = new Map<string, File>();
  private metadata: RuntimeMetadata | undefined;
  private metadataTail: Promise<void> = Promise.resolve();
  private mutationRevision = 0;

  getSnapshot = (): DocumentState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private persist(): void {
    const jobs = serializedJobs(this.state.jobs);
    const payload = JSON.stringify({ version: 1, jobs });
    if (this.metadata !== undefined) {
      const metadata = this.metadata;
      this.metadataTail = this.metadataTail
        .catch(() => undefined)
        .then(() => metadata.set(METADATA_KEY, payload));
      return;
    }
    if (typeof localStorage !== "undefined") localStorage.setItem(STORAGE_KEY, payload);
  }

  private set(partial: Partial<DocumentState>): void {
    this.state = { ...this.state, ...partial };
    this.mutationRevision += 1;
    this.persist();
    for (const listener of this.listeners) listener();
  }

  /** Attach the host SQLite metadata plane and hydrate jobs without moving files. */
  connectMetadata(metadata: RuntimeMetadata | undefined): void {
    if (this.metadata === metadata) return;
    this.metadata = metadata;
    if (metadata === undefined) return;
    const revision = this.mutationRevision;
    void metadata
      .get(METADATA_KEY)
      .then((raw) => {
        if (revision !== this.mutationRevision) return;
        if (raw === undefined) {
          this.persist();
          return;
        }
        const jobs = parseJobs(raw);
        const active = jobs.find((job) => job.id === this.state.activeJobId) ?? jobs[0]!;
        this.state = {
          ...this.state,
          jobs,
          activeJobId: active.id,
          selectedStageId: active.stages[0]?.id ?? "ingest",
        };
        for (const listener of this.listeners) listener();
      })
      .catch(() => undefined);
  }

  addJob(job: DocumentJob, sourceFile?: File): void {
    if (sourceFile !== undefined) this.sourceFiles.set(job.id, sourceFile);
    const jobs = [...this.state.jobs.filter((candidate) => candidate.id !== job.id), job];
    this.set({
      jobs,
      activeJobId: job.id,
      selectedStageId: job.stages[0]?.id ?? "ingest",
      notice: `${job.name} 已加入 Document Inbox`,
    });
  }

  selectJob(jobId: string): void {
    const job = this.state.jobs.find((candidate) => candidate.id === jobId);
    if (job === undefined) return;
    this.set({
      activeJobId: job.id,
      selectedStageId: job.stages[0]?.id ?? "ingest",
      notice: null,
    });
  }

  selectStage(selectedStageId: DocumentStageId): void {
    this.set({ selectedStageId });
  }

  replaceJob(job: DocumentJob): void {
    this.set({
      jobs: this.state.jobs.map((candidate) => (candidate.id === job.id ? job : candidate)),
    });
  }

  removeJob(jobId: string): void {
    this.sourceFiles.delete(jobId);
    const jobs = this.state.jobs.filter((candidate) => candidate.id !== jobId);
    const nextJobs = jobs.length > 0 ? jobs : [demoJob()];
    const active = nextJobs.find((job) => job.id === this.state.activeJobId) ?? nextJobs[0]!;
    this.set({
      jobs: nextJobs,
      activeJobId: active.id,
      selectedStageId: active.stages[0]?.id ?? "ingest",
    });
  }

  setNotice(notice: string | null): void {
    this.set({ notice });
  }

  sourceFile(jobId: string): File | undefined {
    return this.sourceFiles.get(jobId);
  }

  getJob(jobId: string): DocumentJob | undefined {
    return this.state.jobs.find((job) => job.id === jobId);
  }
}

export const documents = new DocumentStore();

export function useDocumentStudio<T>(selector: (state: DocumentState) => T): T {
  return useSyncExternalStore(
    documents.subscribe,
    () => selector(documents.getSnapshot()),
    () => selector(documents.getSnapshot()),
  );
}

export function activeDocument(state: DocumentState): DocumentJob {
  return state.jobs.find((job) => job.id === state.activeJobId) ?? state.jobs[0]!;
}
