import type { DocumentFormat } from "./model";

export type DocumentHandoffTarget = "reader" | "manga";
export type DocumentHandoffStatus = "pending" | "consumed" | "expired";

export interface DocumentHandoff {
  readonly id: string;
  readonly jobId: string;
  readonly target: DocumentHandoffTarget;
  readonly name: string;
  readonly format: DocumentFormat;
  readonly size: number;
  readonly file: File;
  readonly createdAt: number;
}

export interface DocumentHandoffRecord {
  readonly id: string;
  readonly jobId: string;
  readonly target: DocumentHandoffTarget;
  readonly name: string;
  readonly createdAt: number;
  readonly status: DocumentHandoffStatus;
  readonly completedAt?: number | undefined;
}

interface PublishHandoffInput {
  readonly jobId: string;
  readonly target: DocumentHandoffTarget;
  readonly name: string;
  readonly format: DocumentFormat;
  readonly file: File;
}

export interface DocumentHandoffMarker {
  readonly id: string;
  readonly target: DocumentHandoffTarget;
  readonly jobId: string;
  readonly name: string;
  readonly createdAt: number;
}

export const DOCUMENT_HANDOFF_EVENT = "bcr:document-handoff";

const pending = new Map<string, DocumentHandoff>();
const SESSION_KEY = "bcr.document-handoff.v1";
const HISTORY_KEY = "bcr.document-handoff.history.v1";
const MAX_HISTORY = 24;
let memoryHistory: ReadonlyArray<DocumentHandoffRecord> = [];

function createId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `handoff-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

function writeMarker(marker: DocumentHandoffMarker): void {
  if (typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(marker));
  } catch {
    // Private browsing / disabled storage should not prevent an in-tab handoff.
  }
}

function dispatchHandoffEvent(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(DOCUMENT_HANDOFF_EVENT));
}

function readHistory(): ReadonlyArray<DocumentHandoffRecord> {
  if (typeof sessionStorage === "undefined") return memoryHistory;
  try {
    const raw = sessionStorage.getItem(HISTORY_KEY);
    if (raw === null) return memoryHistory;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return memoryHistory;
    const valid = parsed.filter((value): value is DocumentHandoffRecord => {
      if (typeof value !== "object" || value === null) return false;
      const record = value as Partial<DocumentHandoffRecord>;
      return (
        typeof record.id === "string" &&
        typeof record.jobId === "string" &&
        (record.target === "reader" || record.target === "manga") &&
        typeof record.name === "string" &&
        typeof record.createdAt === "number" &&
        (record.status === "pending" || record.status === "consumed" || record.status === "expired")
      );
    });
    memoryHistory = valid.slice(0, MAX_HISTORY);
    return memoryHistory;
  } catch {
    return memoryHistory;
  }
}

function writeHistory(records: ReadonlyArray<DocumentHandoffRecord>): void {
  memoryHistory = records.slice(0, MAX_HISTORY);
  if (typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.setItem(HISTORY_KEY, JSON.stringify(memoryHistory));
  } catch {
    // History is observability only; a disabled session store must not block handoff.
  }
}

function upsertHistory(record: DocumentHandoffRecord): void {
  const next = [record, ...readHistory().filter((candidate) => candidate.id !== record.id)];
  writeHistory(next);
  dispatchHandoffEvent();
}

export function listDocumentHandoffs(limit = 8): ReadonlyArray<DocumentHandoffRecord> {
  return readHistory().slice(0, Math.max(0, limit));
}

/** Mark a target-side failure without ever persisting the file itself. */
export function markDocumentHandoffExpired(
  id: string,
  target: DocumentHandoffTarget,
): DocumentHandoffRecord {
  pending.delete(id);
  const current = readHistory().find((record) => record.id === id);
  if (current !== undefined && (current.status === "expired" || current.status === "consumed")) {
    return current;
  }
  const marker = getDocumentHandoffMarker();
  const record: DocumentHandoffRecord = {
    id,
    jobId: current?.jobId ?? (marker?.id === id ? marker.jobId : "unknown"),
    target,
    name: current?.name ?? (marker?.id === id ? marker.name : "未知源文件"),
    createdAt: current?.createdAt ?? (marker?.id === id ? marker.createdAt : Date.now()),
    status: "expired",
    completedAt: Date.now(),
  };
  upsertHistory(record);
  clearMarker(id);
  return record;
}

/** Read the lightweight marker left behind when a target cannot consume a handoff. */
export function getDocumentHandoffMarker(): DocumentHandoffMarker | undefined {
  if (typeof sessionStorage === "undefined") return undefined;
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (raw === null) return undefined;
    const marker = JSON.parse(raw) as Partial<DocumentHandoffMarker>;
    if (
      typeof marker.id !== "string" ||
      (marker.target !== "reader" && marker.target !== "manga") ||
      typeof marker.jobId !== "string" ||
      typeof marker.name !== "string" ||
      typeof marker.createdAt !== "number"
    ) {
      return undefined;
    }
    return marker as DocumentHandoffMarker;
  } catch {
    return undefined;
  }
}

function clearMarker(id: string): void {
  if (typeof sessionStorage === "undefined") return;
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (raw === null || (JSON.parse(raw) as { id?: unknown }).id === id) {
      sessionStorage.removeItem(SESSION_KEY);
    }
  } catch {
    // Best effort only; the File stays in the module-local handoff map.
  }
}

/**
 * Publish a one-tab handoff. The File never goes through the URL or storage;
 * only a small marker is persisted so a target can explain an expired link.
 */
export function publishDocumentHandoff(input: PublishHandoffInput): string {
  const id = createId();
  const handoff: DocumentHandoff = {
    id,
    jobId: input.jobId,
    target: input.target,
    name: input.name,
    format: input.format,
    size: input.file.size,
    file: input.file,
    createdAt: Date.now(),
  };
  pending.set(id, handoff);
  upsertHistory({
    id,
    jobId: handoff.jobId,
    target: handoff.target,
    name: handoff.name,
    createdAt: handoff.createdAt,
    status: "pending",
  });
  writeMarker({
    id,
    target: input.target,
    jobId: input.jobId,
    name: input.name,
    createdAt: handoff.createdAt,
  });
  return id;
}

/** Consume a handoff exactly once and only in the intended target app. */
export function consumeDocumentHandoff(
  id: string,
  target: DocumentHandoffTarget,
): DocumentHandoff | undefined {
  const handoff = pending.get(id);
  if (handoff === undefined || handoff.target !== target) return undefined;
  pending.delete(id);
  clearMarker(id);
  upsertHistory({
    id: handoff.id,
    jobId: handoff.jobId,
    target: handoff.target,
    name: handoff.name,
    createdAt: handoff.createdAt,
    status: "consumed",
    completedAt: Date.now(),
  });
  return handoff;
}

export function hasDocumentHandoff(id: string): boolean {
  return pending.has(id);
}
