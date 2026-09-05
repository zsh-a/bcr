import {
  artifactStore,
  ArtifactStoreTag,
  createRuntimeHost,
  executorRegistry,
  Executors,
  memoryCacheStore,
  memoryTaskJournal,
  resourceManagerLive,
  ResourceManagerTag,
  SchedulerTag,
  schedulerWithServices,
  type ArtifactStore,
  type RuntimeExecutor,
  type RuntimeHost,
  type RuntimeSession,
} from "@bcr/core";
import { isOpfsSupported, MemoryStore, OpfsStore, type BinaryStore } from "@bcr/storage-opfs";
import {
  sqliteCacheStore,
  sqliteLineageStore,
  sqliteTaskJournal,
  type SqliteDb,
} from "@bcr/storage-sqlite";
import { Context, Effect, Exit, Layer, Scope } from "effect";
import { acquireProjectLease } from "./project-lease";

export interface ExecutionModule {
  readonly executors: ReadonlyArray<RuntimeExecutor>;
  readonly dispose: () => void | Promise<void>;
}

export interface BrowserRuntimeOptions {
  readonly namespace: string;
  readonly host?: RuntimeHost | undefined;
  /** Test/non-OPFS modules may inject their own data plane. */
  readonly store?: BinaryStore;
  readonly openMetadata?: (store: BinaryStore) => Promise<SqliteDb>;
  readonly execution: (artifacts: ArtifactStore, store: BinaryStore) => ExecutionModule;
  readonly onMetadataUnavailable?: (error: unknown) => void;
}

/** Storage, scheduler, resources and execution share one lifetime. */
export async function createBrowserRuntime(
  options: BrowserRuntimeOptions,
): Promise<RuntimeSession> {
  // Current browser compute modules read OPFS directly. Reject unsupported
  // deployments at boot instead of advertising a non-working memory fallback.
  if (options.store === undefined && !isOpfsSupported()) {
    throw new Error("This compute workspace requires OPFS support");
  }
  const store = options.store ?? new OpfsStore(options.namespace);
  const releaseProject =
    options.store === undefined
      ? await acquireProjectLease(navigator.locks, options.namespace)
      : undefined;
  const scope = await Effect.runPromise(Scope.make());
  let db: SqliteDb | undefined;
  let execution: ExecutionModule | undefined;
  let detach: (() => void) | undefined;
  let scheduler: RuntimeSession["scheduler"] | undefined;
  let closing: Promise<void> | undefined;
  const dispose = () =>
    (closing ??= (async () => {
      const errors: unknown[] = [];
      for (const close of [
        () => (scheduler === undefined ? Promise.resolve() : Effect.runPromise(scheduler.shutdown)),
        () => execution?.dispose(),
        () => db?.close(),
        () => Effect.runPromise(Scope.close(scope, Exit.void)),
        () => releaseProject?.(),
      ]) {
        try {
          await close();
        } catch (error) {
          errors.push(error);
        }
      }
      detach?.();
      if (errors.length > 0) throw new AggregateError(errors, "Runtime session shutdown failed");
    })());
  try {
    try {
      db = await options.openMetadata?.(store);
    } catch (error) {
      options.onMetadataUnavailable?.(error);
    }

    const resourceContext =
      options.host === undefined
        ? await Effect.runPromise(Layer.buildWithScope(resourceManagerLive(), scope))
        : undefined;
    const host =
      options.host ?? createRuntimeHost(Context.get(resourceContext!, ResourceManagerTag));
    const artifactContext = await Effect.runPromise(
      Layer.buildWithScope(
        artifactStore({ memory: new MemoryStore(), opfs: store }, db && sqliteLineageStore(db)),
        scope,
      ),
    );
    const artifacts = Context.get(artifactContext, ArtifactStoreTag);
    execution = options.execution(artifacts, store);
    const dependencies = Layer.mergeAll(
      Layer.succeed(ArtifactStoreTag, artifacts),
      Layer.succeed(ResourceManagerTag, host.resources),
      Layer.succeed(Executors, executorRegistry(execution.executors)),
      db === undefined ? memoryCacheStore() : sqliteCacheStore(db),
      db === undefined ? memoryTaskJournal() : sqliteTaskJournal(db),
    );
    const context = await Effect.runPromise(
      Layer.buildWithScope(Layer.provide(schedulerWithServices, dependencies), scope),
    );
    scheduler = Context.get(context, SchedulerTag);
    const session: RuntimeSession = {
      scheduler,
      artifacts,
      host,
      dispose,
      ...(db === undefined ? {} : { metadata: { get: db.kvGet, set: db.kvSet } }),
    };
    detach = host.attach(session);
    return session;
  } catch (error) {
    try {
      await dispose();
    } catch {
      /* Preserve the initialization failure. */
    }
    throw error;
  }
}
