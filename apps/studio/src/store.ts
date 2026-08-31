import { useSyncExternalStore } from "react";
import type { ArtifactRef } from "@bcr/core";

/**
 * Studio 应用状态（§12 状态分层：不建巨型 store，
 * 仅收 Runtime 事件投影 + 少量 UI selection；URL 状态归 TanStack Router）。
 */

export interface FileRecord {
  readonly ref: ArtifactRef;
  readonly name: string;
  readonly size: number;
  readonly addedAt: number;
}

export type TaskStatus = "queued" | "running" | "completed" | "failed" | "cancelled" | "blocked";

export interface TaskRecord {
  readonly id: string;
  readonly operation: string;
  readonly runtime: string;
  readonly inputId: string;
  status: TaskStatus;
  progress: number;
  cached: boolean;
  outputs?: ReadonlyArray<ArtifactRef> | undefined;
  error?: string | undefined;
  readonly startedAt: number;
  durationMs?: number | undefined;
}

export type LogLevel = "info" | "ok" | "warn" | "error";

export interface LogEntry {
  readonly ts: number;
  readonly level: LogLevel;
  readonly message: string;
}

export interface StudioState {
  readonly files: ReadonlyArray<FileRecord>;
  readonly tasks: ReadonlyArray<TaskRecord>;
  readonly logs: ReadonlyArray<LogEntry>;
  readonly runningCount: number;
}

const MAX_LOGS = 2000;

class StudioStore {
  private state: StudioState = {
    files: [],
    tasks: [],
    logs: [],
    runningCount: 0,
  };
  private readonly listeners = new Set<() => void>();

  getSnapshot = (): StudioState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private set(partial: Partial<StudioState>): void {
    this.state = { ...this.state, ...partial };
    for (const listener of this.listeners) listener();
  }

  addFile(file: FileRecord): void {
    this.set({ files: [...this.state.files.filter((item) => item.ref.id !== file.ref.id), file] });
  }

  upsertTask(record: TaskRecord): void {
    const index = this.state.tasks.findIndex((t) => t.id === record.id);
    const tasks =
      index >= 0
        ? this.state.tasks.map((t, i) => (i === index ? record : t))
        : [record, ...this.state.tasks];
    this.set({
      tasks,
      runningCount: tasks.filter((t) => t.status === "queued" || t.status === "running").length,
    });
  }

  patchTask(id: string, patch: Partial<TaskRecord>): void {
    const existing = this.state.tasks.find((t) => t.id === id);
    if (existing === undefined) return;
    this.upsertTask({ ...existing, ...patch });
  }

  log(level: LogLevel, message: string): void {
    const entry: LogEntry = { ts: Date.now(), level, message };
    const logs = [...this.state.logs, entry].slice(-MAX_LOGS);
    this.set({ logs });
  }

  clearLogs(): void {
    this.set({ logs: [] });
  }
}

export const studio = new StudioStore();

export function useStudio<T>(selector: (state: StudioState) => T): T {
  return useSyncExternalStore(studio.subscribe, () => selector(studio.getSnapshot()));
}
