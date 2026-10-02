import { type ArtifactStore } from "@bcr/core";
import { type BinaryStore } from "@bcr/storage-opfs";
import { type SqliteDb } from "@bcr/storage-sqlite";
import { MangaModelRegistry } from "../models/model-registry";

export interface MangaStorageContext {
  readonly artifacts: ArtifactStore;
  readonly binary: BinaryStore;
  readonly meta: SqliteDb | undefined;
  readonly models: MangaModelRegistry;
}
