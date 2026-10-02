import type { ArtifactStore, Scheduler } from "@bcr/core";
import type { MangaModelRegistry } from "../models/model-registry";
import type { MangaStore } from "../project/store";

/** Resources borrowed by session-owned pipeline execution. */
export interface MangaExecutionContext {
  readonly artifacts: ArtifactStore;
  readonly models: MangaModelRegistry;
  readonly store: MangaStore;
}

export interface MangaComputeServices {
  readonly artifacts: ArtifactStore;
  readonly scheduler: Pick<Scheduler, "submit">;
}
