import type { ArtifactRef } from "@bcr/core";
import type { DocumentContentPackage } from "./content";
import type { DocumentFormat } from "./model";
import type { DocumentTranslationPackage } from "./translation";

/** Workbench that should receive a durable document handoff. */
export type DocumentHandoffTarget = "reader" | "manga" | "document";
export type DocumentHandoffStatus = "pending" | "consumed" | "expired";

export interface DocumentHandoff {
  readonly id: string;
  readonly jobId: string;
  readonly target: DocumentHandoffTarget;
  readonly name: string;
  readonly format: DocumentFormat;
  readonly size: number;
  /** Optional tab-local fast path. Durable handoffs use sourceRef instead. */
  readonly file?: File | undefined;
  /** Immutable source object; the target can rebuild a File after a refresh. */
  readonly sourceRef?: ArtifactRef | undefined;
  /** Optional canonical content artifact; inline content remains a fast path. */
  readonly contentRef?: ArtifactRef | undefined;
  /** Optional translated content artifact; inline translation remains a fast path. */
  readonly translationRef?: ArtifactRef | undefined;
  /** Optional normalized payload; kept in memory for a zero-copy handoff. */
  readonly content?: DocumentContentPackage | undefined;
  /** Optional reviewed translation that shares the same block IDs as content. */
  readonly translation?: DocumentTranslationPackage | undefined;
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

export interface PublishDocumentHandoffInput {
  readonly jobId: string;
  readonly target: DocumentHandoffTarget;
  readonly name: string;
  readonly format: DocumentFormat;
  /** Kept for an immediate same-tab fast path; not serialized. */
  readonly file?: File | undefined;
  /** Durable source artifact. Required when the File is not available later. */
  readonly sourceRef?: ArtifactRef | undefined;
  readonly contentRef?: ArtifactRef | undefined;
  readonly translationRef?: ArtifactRef | undefined;
  /** Optional size when publishing without a File. */
  readonly size?: number | undefined;
  readonly content?: DocumentContentPackage | undefined;
  readonly translation?: DocumentTranslationPackage | undefined;
}

export interface DocumentHandoffMarker {
  readonly id: string;
  readonly target: DocumentHandoffTarget;
  readonly jobId: string;
  readonly name: string;
  readonly format: DocumentFormat;
  readonly size: number;
  readonly sourceRef?: ArtifactRef | undefined;
  readonly contentRef?: ArtifactRef | undefined;
  readonly translationRef?: ArtifactRef | undefined;
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

function isArtifactRef(value: unknown): value is ArtifactRef {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<ArtifactRef>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.type === "string" &&
    (candidate.storage === "memory" ||
      candidate.storage === "shared-memory" ||
      candidate.storage === "opfs")
  );
}

function isDocumentFormat(value: unknown): value is DocumentFormat {
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
        (record.target === "reader" || record.target === "manga" || record.target === "document") &&
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
      (marker.target !== "reader" && marker.target !== "manga" && marker.target !== "document") ||
      typeof marker.jobId !== "string" ||
      typeof marker.name !== "string" ||
      typeof marker.createdAt !== "number"
    ) {
      return undefined;
    }
    // v1 markers only carried identity fields. Keep them consumable after an
    // upgrade; durable refs are optional and targets will report a useful
    // recovery error when neither a ref nor a tab-local File is available.
    const format = isDocumentFormat(marker.format) ? marker.format : "unknown";
    const size =
      typeof marker.size === "number" && Number.isFinite(marker.size)
        ? Math.max(0, marker.size)
        : 0;
    return {
      id: marker.id,
      target: marker.target,
      jobId: marker.jobId,
      name: marker.name,
      format,
      size,
      ...(isArtifactRef(marker.sourceRef) ? { sourceRef: marker.sourceRef } : {}),
      ...(isArtifactRef(marker.contentRef) ? { contentRef: marker.contentRef } : {}),
      ...(isArtifactRef(marker.translationRef) ? { translationRef: marker.translationRef } : {}),
      createdAt: marker.createdAt,
    };
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
    // Best effort only; the in-memory fast path may still be available.
  }
}

/**
 * Publish a handoff. A File is kept only as an immediate same-tab fast path;
 * source/content/translation refs make the handoff recoverable after refresh.
 */
export function publishDocumentHandoff(input: PublishDocumentHandoffInput): string {
  if (input.file === undefined && input.sourceRef === undefined) {
    throw new Error("document handoff requires a File or durable sourceRef");
  }
  const id = createId();
  const size = Math.max(0, input.size ?? input.file?.size ?? 0);
  const handoff: DocumentHandoff = {
    id,
    jobId: input.jobId,
    target: input.target,
    name: input.name,
    format: input.format,
    size,
    ...(input.file === undefined ? {} : { file: input.file }),
    ...(input.sourceRef === undefined ? {} : { sourceRef: input.sourceRef }),
    ...(input.contentRef === undefined ? {} : { contentRef: input.contentRef }),
    ...(input.translationRef === undefined ? {} : { translationRef: input.translationRef }),
    ...(input.content === undefined ? {} : { content: input.content }),
    ...(input.translation === undefined ? {} : { translation: input.translation }),
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
    format: input.format,
    size: handoff.size,
    ...(handoff.sourceRef === undefined ? {} : { sourceRef: handoff.sourceRef }),
    ...(handoff.contentRef === undefined ? {} : { contentRef: handoff.contentRef }),
    ...(handoff.translationRef === undefined ? {} : { translationRef: handoff.translationRef }),
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
  if (handoff === undefined) {
    const marker = getDocumentHandoffMarker();
    if (marker?.id !== id || marker.target !== target) return undefined;
    const recovered: DocumentHandoff = {
      id: marker.id,
      jobId: marker.jobId,
      target: marker.target,
      name: marker.name,
      format: marker.format,
      size: marker.size,
      ...(marker.sourceRef === undefined ? {} : { sourceRef: marker.sourceRef }),
      ...(marker.contentRef === undefined ? {} : { contentRef: marker.contentRef }),
      ...(marker.translationRef === undefined ? {} : { translationRef: marker.translationRef }),
      createdAt: marker.createdAt,
    };
    clearMarker(id);
    upsertHistory({
      id: recovered.id,
      jobId: recovered.jobId,
      target: recovered.target,
      name: recovered.name,
      createdAt: recovered.createdAt,
      status: "consumed",
      completedAt: Date.now(),
    });
    return recovered;
  }
  if (handoff.target !== target) return undefined;
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
  return pending.has(id) || getDocumentHandoffMarker()?.id === id;
}
