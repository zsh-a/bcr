import type { SqliteDb } from "@bcr/storage-sqlite";
import {
  clearMangaModelCache,
  inspectMangaModelCache,
  type MangaModelCacheInfo,
} from "./model-cache";
import {
  OCR_MODEL_MANIFESTS,
  TRANSLATION_MODEL_MANIFESTS,
  type MangaAdapterExecution,
} from "./model";

export type MangaModelKind = "ocr" | "translation";
export type MangaModelStatus = "unknown" | "loading" | "ready" | "error";

/** A stable model identity; changing catalogVersion invalidates old lifecycle facts. */
export interface MangaModelCatalogEntry {
  readonly key: string;
  readonly kind: MangaModelKind;
  readonly model: string;
  readonly label: string;
  readonly runtime: "wasm" | "webgpu";
  readonly catalogVersion: 1;
}

export interface MangaModelRecord extends MangaModelCatalogEntry {
  readonly status: MangaModelStatus;
  readonly lastUsedAt?: number | undefined;
  readonly lastLoadedAt?: number | undefined;
  readonly lastError?: string | undefined;
}

export interface MangaModelRegistrySnapshot {
  readonly version: 1;
  readonly records: ReadonlyArray<MangaModelRecord>;
}

const REGISTRY_KEY = "manga-model-registry";
const CATALOG_VERSION = 1 as const;

function modelKey(kind: MangaModelKind, model: string): string {
  return `${kind}:${model}`;
}

/** Manifest-derived catalog used by UI, pipeline and future download controls. */
export function mangaModelCatalog(): ReadonlyArray<MangaModelCatalogEntry> {
  const entries: MangaModelCatalogEntry[] = [];
  for (const manifest of OCR_MODEL_MANIFESTS) {
    if (manifest.model === undefined) continue;
    entries.push({
      key: modelKey("ocr", manifest.model),
      kind: "ocr",
      model: manifest.model,
      label: manifest.label,
      runtime: manifest.runtime === "review" ? "wasm" : manifest.runtime,
      catalogVersion: CATALOG_VERSION,
    });
  }
  const seen = new Set(entries.map((entry) => entry.key));
  for (const manifest of TRANSLATION_MODEL_MANIFESTS) {
    for (const model of Object.values(manifest.models)) {
      if (model === undefined) continue;
      const key = modelKey("translation", model);
      if (seen.has(key)) continue;
      seen.add(key);
      entries.push({
        key,
        kind: "translation",
        model,
        label: manifest.label,
        runtime: manifest.runtime === "fixture" ? "wasm" : manifest.runtime,
        catalogVersion: CATALOG_VERSION,
      });
    }
  }
  return entries;
}

function validRecord(value: unknown): value is MangaModelRecord {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate["key"] === "string" &&
    (candidate["kind"] === "ocr" || candidate["kind"] === "translation") &&
    typeof candidate["model"] === "string" &&
    typeof candidate["label"] === "string" &&
    (candidate["runtime"] === "wasm" || candidate["runtime"] === "webgpu") &&
    candidate["catalogVersion"] === CATALOG_VERSION &&
    (candidate["status"] === "unknown" ||
      candidate["status"] === "loading" ||
      candidate["status"] === "ready" ||
      candidate["status"] === "error") &&
    (candidate["lastUsedAt"] === undefined || typeof candidate["lastUsedAt"] === "number") &&
    (candidate["lastLoadedAt"] === undefined || typeof candidate["lastLoadedAt"] === "number") &&
    (candidate["lastError"] === undefined || typeof candidate["lastError"] === "string")
  );
}

function now(): number {
  return Date.now();
}

/**
 * Small metadata registry for model lifecycle facts. Byte ownership stays in a
 * versioned Cache API namespace; clearing it also invalidates readiness facts.
 */
export class MangaModelRegistry {
  private records = new Map<string, MangaModelRecord>();
  private readonly listeners = new Set<() => void>();
  private persistChain: Promise<void> = Promise.resolve();

  constructor(private readonly db: SqliteDb | undefined) {}

  getSnapshot = (): MangaModelRegistrySnapshot => ({
    version: 1,
    records: [...this.records.values()].sort((left, right) => left.key.localeCompare(right.key)),
  });

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  get(key: string): MangaModelRecord | undefined {
    return this.records.get(key);
  }

  getForExecution(execution: MangaAdapterExecution): MangaModelRecord | undefined {
    if (execution.model === undefined || execution.model.trim().length === 0) return undefined;
    return this.get(modelKey(execution.kind, execution.model));
  }

  statusForExecution(execution: MangaAdapterExecution): MangaModelStatus {
    return this.getForExecution(execution)?.status ?? "unknown";
  }

  /** Inspect file counts only; model bytes never enter the React state tree. */
  async inspectCache(): Promise<MangaModelCacheInfo> {
    return inspectMangaModelCache([
      ...new Set([
        ...mangaModelCatalog().map((entry) => entry.model),
        ...this.records.values().map((entry) => entry.model),
      ]),
    ]);
  }

  /** Clear the product-owned cache and invalidate readiness metadata together. */
  async clearCache(): Promise<boolean> {
    const deleted = await clearMangaModelCache();
    if (!deleted) return false;
    this.records = new Map(
      [...this.records.entries()].map(([key, record]) => [
        key,
        {
          ...record,
          status: "unknown" as const,
          lastLoadedAt: undefined,
          lastError: undefined,
        },
      ]),
    );
    this.emit();
    this.enqueuePersist();
    return true;
  }

  async restore(): Promise<void> {
    if (this.db === undefined) return;
    const raw = await this.db.kvGet(REGISTRY_KEY);
    if (raw === undefined) return;
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (typeof parsed !== "object" || parsed === null) return;
      const value = parsed as { version?: unknown; records?: unknown };
      if (value.version !== 1 || !Array.isArray(value.records)) return;
      const catalog = new Map(mangaModelCatalog().map((entry) => [entry.key, entry]));
      this.records = new Map(
        value.records.flatMap((candidate) => {
          if (!validRecord(candidate)) return [];
          const current = catalog.get(candidate.key);
          // Drop records for removed/revised models instead of showing stale readiness.
          if (
            current === undefined ||
            current.model !== candidate.model ||
            current.catalogVersion !== candidate.catalogVersion
          ) {
            return [];
          }
          return [[candidate.key, { ...current, ...candidate } satisfies MangaModelRecord]];
        }),
      );
      this.emit();
    } catch {
      // Corrupt registry metadata must not prevent the Manga runtime from booting.
      this.records.clear();
    }
  }

  async markLoading(execution: MangaAdapterExecution): Promise<void> {
    this.update(execution, "loading");
  }

  async markReady(execution: MangaAdapterExecution): Promise<void> {
    this.update(execution, "ready");
  }

  async markError(execution: MangaAdapterExecution, error: unknown): Promise<void> {
    this.update(execution, "error", error instanceof Error ? error.message : String(error));
  }

  private update(execution: MangaAdapterExecution, status: MangaModelStatus, error?: string): void {
    if (execution.model === undefined || execution.model.trim().length === 0) return;
    const key = modelKey(execution.kind, execution.model);
    const catalog = mangaModelCatalog().find((entry) => entry.key === key);
    const entry: MangaModelCatalogEntry = catalog ?? {
      key,
      kind: execution.kind,
      model: execution.model,
      label: "Custom model",
      runtime: execution.effectiveDevice === "webgpu" ? "webgpu" : "wasm",
      catalogVersion: CATALOG_VERSION,
    };
    const timestamp = now();
    const record: MangaModelRecord = {
      ...entry,
      status,
      lastUsedAt: timestamp,
      ...(status === "loading" ? { lastError: undefined } : {}),
      ...(status === "ready" ? { lastLoadedAt: timestamp, lastError: undefined } : {}),
      ...(status === "error" ? { lastError: error ?? "unknown model error" } : {}),
    };
    this.records.set(key, record);
    this.emit();
    this.enqueuePersist();
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }

  private enqueuePersist(): void {
    this.persistChain = this.persistChain
      .catch(() => undefined)
      .then(async () => {
        if (this.db !== undefined) {
          await this.db.kvSet(REGISTRY_KEY, JSON.stringify(this.getSnapshot()));
        }
      });
  }
}

export function modelKeyForExecution(execution: MangaAdapterExecution): string | undefined {
  return execution.model === undefined || execution.model.trim().length === 0
    ? undefined
    : modelKey(execution.kind, execution.model);
}
