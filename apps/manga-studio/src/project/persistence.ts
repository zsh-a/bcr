import { type ArtifactRef } from "@bcr/core";
import { decodeGraph, encodeGraph } from "@bcr/graph";
import { manga } from "./store";
import type {
  MangaBatchJob,
  MangaGlossaryEntry,
  MangaPage,
  MangaSettings,
  MangaSource,
} from "./model";
import { type MangaStorageContext } from "./context";
import { restoreSource } from "./source";

export interface PersistedSource {
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
  readonly createdAt?: number | undefined;
  readonly stages: MangaPage["stages"];
  readonly regions: MangaPage["regions"];
  readonly activeRegionId: MangaPage["activeRegionId"];
  readonly outputMode: MangaPage["outputMode"];
  readonly outputReady: boolean;
  readonly dirty: boolean;
  readonly documentContentRef?: ArtifactRef | undefined;
  readonly documentTranslationRef?: ArtifactRef | undefined;
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
    ...(page.createdAt === undefined ? {} : { createdAt: page.createdAt }),
    stages: page.stages,
    regions: page.regions,
    activeRegionId: page.activeRegionId,
    outputMode: page.outputMode,
    outputReady: page.outputReady,
    dirty: page.dirty,
    ...(page.documentContentRef === undefined
      ? {}
      : { documentContentRef: page.documentContentRef }),
    ...(page.documentTranslationRef === undefined
      ? {}
      : { documentTranslationRef: page.documentTranslationRef }),
  };
}

export async function persistProject(runtime: MangaStorageContext): Promise<void> {
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

export async function restoreProject(runtime: MangaStorageContext): Promise<boolean> {
  if (runtime.meta === undefined) return false;
  try {
    const raw = await runtime.meta.kvGet("manga-project");
    if (raw === undefined) return false;
    const project = JSON.parse(raw) as PersistedProject;
    if (project.version !== 1 || !Array.isArray(project.pages) || project.pages.length === 0) {
      throw new Error("无法读取 Manga 项目版本，请先检查或恢复项目数据");
    }

    const pages: MangaPage[] = [];
    const persistedPages = project.pages as ReadonlyArray<PersistedPage>;
    for (const persisted of persistedPages) {
      const source = await restoreSource(runtime, persisted.source);
      if (source === null) continue;
      pages.push({
        id: persisted.id,
        source,
        ...(persisted.createdAt === undefined ? {} : { createdAt: persisted.createdAt }),
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
        ...(persisted.documentContentRef === undefined
          ? {}
          : { documentContentRef: persisted.documentContentRef }),
        ...(persisted.documentTranslationRef === undefined
          ? {}
          : { documentTranslationRef: persisted.documentTranslationRef }),
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
    throw error;
  }
}
