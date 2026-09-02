import {
  artifactPath,
  artifactStore,
  ArtifactStoreTag,
  hashReadableStream,
  type ArtifactRef,
  type ArtifactStore,
} from "@bcr/core";
import { isOpfsSupported, MemoryStore, OpfsStore, type BinaryStore } from "@bcr/storage-opfs";
import { openSqliteDb, sqliteLineageStore, type SqliteDb } from "@bcr/storage-sqlite";
import initSqlite from "@sqlite.org/sqlite-wasm";
import wasmUrl from "@sqlite.org/sqlite-wasm/sqlite3.wasm?url";
import { Context, Effect, Layer } from "effect";
import { decodeGraph, encodeGraph } from "@bcr/graph";
import { FIXTURE_PAGE_URL } from "./fixture";
import { manga } from "./store";
import type {
  MangaBatchJob,
  MangaGlossaryEntry,
  MangaPage,
  MangaSettings,
  MangaSource,
} from "./model";

export interface MangaRuntime {
  readonly artifacts: ArtifactStore;
  readonly binary: BinaryStore;
  readonly meta: SqliteDb | undefined;
}

interface SqliteInit {
  (options?: {
    locateFile?: (file: string) => string;
  }): Promise<Parameters<typeof openSqliteDb>[0]["sqlite3"]>;
}

interface PersistedSource {
  readonly id: string;
  readonly kind: MangaSource["kind"];
  readonly name: string;
  readonly size: number;
  readonly width: number;
  readonly height: number;
  readonly pageCount: number;
  readonly ref?: ArtifactRef | undefined;
}

interface PersistedPage {
  readonly id: string;
  readonly source: PersistedSource;
  readonly stages: MangaPage["stages"];
  readonly regions: MangaPage["regions"];
  readonly activeRegionId: MangaPage["activeRegionId"];
  readonly outputMode: MangaPage["outputMode"];
  readonly outputReady: boolean;
  readonly dirty: boolean;
}

interface PersistedProject {
  readonly version: 1;
  readonly activePageId: string;
  readonly pages: ReadonlyArray<PersistedPage>;
  readonly settings: MangaSettings;
  readonly glossary?: ReadonlyArray<MangaGlossaryEntry> | undefined;
  readonly graph: string;
  readonly batch?: MangaBatchJob | undefined;
}

let currentRuntime: MangaRuntime | undefined;

async function openMetaDb(store: OpfsStore | MemoryStore): Promise<SqliteDb> {
  const init = initSqlite as unknown as SqliteInit;
  const sqlite3 = await init({ locateFile: () => wasmUrl });
  return openSqliteDb({ store, path: "project/meta.db", sqlite3 });
}

/** Build the storage plane independently from the eventual OCR/GPU executors. */
export async function createMangaRuntime(): Promise<MangaRuntime> {
  const opfs = isOpfsSupported() ? new OpfsStore("manga") : new MemoryStore();
  const memory = new MemoryStore();
  let meta: SqliteDb | undefined;
  try {
    meta = await openMetaDb(opfs);
    manga.log("ok", "sqlite · manga project metadata online");
  } catch (error) {
    manga.log("warn", `sqlite unavailable · using memory metadata · ${String(error)}`);
  }

  const context = await Effect.runPromise(
    Effect.scoped(Layer.build(artifactStore({ memory, opfs }, meta && sqliteLineageStore(meta)))),
  );
  const artifacts = Context.get(context, ArtifactStoreTag);
  const runtime: MangaRuntime = {
    artifacts,
    binary: opfs,
    meta,
  };
  currentRuntime = runtime;
  return runtime;
}

export function mangaRuntime(): MangaRuntime | undefined {
  return currentRuntime;
}

/** Stream a user file into the same Artifact namespace used by future OCR tasks. */
export async function importImageArtifact(
  runtime: MangaRuntime,
  file: File,
  sharedArtifacts?: ArtifactStore,
): Promise<ArtifactRef> {
  const hash = await hashReadableStream(file.stream());
  const storage: ArtifactRef["storage"] = runtime.binary instanceof MemoryStore ? "memory" : "opfs";
  const ref: ArtifactRef = {
    id: `source/${hash}`,
    type: "file/image",
    storage,
    format: file.type || "image/*",
    hash,
  };
  await Effect.runPromise(runtime.artifacts.putStream(ref, file.stream()));
  // Manga owns its project metadata namespace, while the Studio Shell owns
  // the shared Scheduler/WorkerPool namespace. Keep one immutable source ref
  // in both planes so the review OCR task can consume it without coupling the
  // local persistence model to the host shell.
  if (sharedArtifacts !== undefined && sharedArtifacts !== runtime.artifacts) {
    try {
      await Effect.runPromise(sharedArtifacts.putStream(ref, file.stream()));
    } catch (error) {
      manga.log("warn", `artifact bridge · worker source unavailable · ${String(error)}`);
    }
  }
  return ref;
}

function persistSource(source: MangaSource): PersistedSource {
  return {
    id: source.id,
    kind: source.kind,
    name: source.name,
    size: source.size,
    width: source.width,
    height: source.height,
    pageCount: source.pageCount,
    ...(source.ref === undefined ? {} : { ref: source.ref }),
  };
}

function persistPage(page: MangaPage): PersistedPage {
  return {
    id: page.id,
    source: persistSource(page.source),
    stages: page.stages,
    regions: page.regions,
    activeRegionId: page.activeRegionId,
    outputMode: page.outputMode,
    outputReady: page.outputReady,
    dirty: page.dirty,
  };
}

export async function persistProject(runtime: MangaRuntime): Promise<void> {
  if (runtime.meta === undefined) return;
  const state = manga.getSnapshot();
  const project: PersistedProject = {
    version: 1,
    activePageId: state.activePageId,
    pages: state.pages.map(persistPage),
    settings: state.settings,
    glossary: state.glossary,
    graph: encodeGraph(state.graph),
    ...(state.batch === undefined ? {} : { batch: state.batch }),
  };
  try {
    await runtime.meta.kvSet("manga-project", JSON.stringify(project));
  } catch (error) {
    manga.log("warn", `persist project failed · ${String(error)}`);
  }
}

async function restoreSource(
  runtime: MangaRuntime,
  source: PersistedSource,
): Promise<MangaSource | null> {
  if (source.kind === "fixture") {
    return { ...source, objectUrl: FIXTURE_PAGE_URL };
  }
  if (source.ref === undefined) return null;
  try {
    const blob =
      source.ref.storage === "opfs" && runtime.binary.getBlob !== undefined
        ? await runtime.binary.getBlob(artifactPath(source.ref))
        : undefined;
    const bytes =
      blob === undefined ? await Effect.runPromise(runtime.artifacts.get(source.ref)) : undefined;
    const objectUrl = URL.createObjectURL(
      blob ??
        new Blob([
          (bytes as Uint8Array).buffer.slice(
            (bytes as Uint8Array).byteOffset,
            (bytes as Uint8Array).byteOffset + (bytes as Uint8Array).byteLength,
          ) as BlobPart,
        ]),
    );
    return { ...source, objectUrl, ref: source.ref };
  } catch (error) {
    manga.log("warn", `restore · ${source.name} artifact missing · ${String(error)}`);
    return null;
  }
}

export async function restoreProject(runtime: MangaRuntime): Promise<boolean> {
  if (runtime.meta === undefined) return false;
  try {
    const raw = await runtime.meta.kvGet("manga-project");
    if (raw === undefined) return false;
    const project = JSON.parse(raw) as PersistedProject;
    if (project.version !== 1 || !Array.isArray(project.pages) || project.pages.length === 0) {
      manga.log("warn", "restore · unsupported manga project version");
      return false;
    }

    const pages: MangaPage[] = [];
    const persistedPages = project.pages as ReadonlyArray<PersistedPage>;
    for (const persisted of persistedPages) {
      const source = await restoreSource(runtime, persisted.source);
      if (source === null) continue;
      pages.push({
        id: persisted.id,
        source,
        // A tab can be closed while a stage is running. Restore that stage as
        // idle so the UI reflects the paused checkpoint and the next queue run
        // retries it instead of presenting a stale RUNNING state.
        stages: persisted.stages.map((stage) =>
          stage.status === "running"
            ? { ...stage, status: "idle", progress: 0, error: undefined }
            : stage,
        ),
        regions: persisted.regions,
        activeRegionId: persisted.activeRegionId,
        outputMode: persisted.outputMode,
        outputReady: persisted.outputReady,
        dirty: persisted.dirty,
      });
    }
    if (pages.length === 0) return false;

    const graph = decodeGraph(project.graph);
    manga.restoreConfig(project.settings, graph ?? manga.getSnapshot().graph);
    manga.restoreGlossary(project.glossary);
    manga.setPages(pages, project.activePageId);
    manga.restoreBatch(project.batch);
    manga.log("ok", `restore · ${pages.length} page(s) · ${manga.getSnapshot().source.name}`);
    return true;
  } catch (error) {
    manga.log("warn", `restore project failed · ${String(error)}`);
    return false;
  }
}
