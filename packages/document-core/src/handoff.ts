import type { DocumentFormat } from "./model";

export type DocumentHandoffTarget = "reader" | "manga";

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

const pending = new Map<string, DocumentHandoff>();
const SESSION_KEY = "bcr.document-handoff.v1";

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
  return handoff;
}

export function hasDocumentHandoff(id: string): boolean {
  return pending.has(id);
}
