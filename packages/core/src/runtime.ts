import { Effect } from "effect";
import type { ArtifactStore, ArtifactUsage } from "./artifact";
import type { ResourceManager } from "./resource-manager";
import type { Scheduler } from "./scheduler";
import type { SearchIndex } from "./search";

export interface RuntimeMetadata {
  readonly get: (key: string) => Promise<string | undefined>;
  readonly set: (key: string, value: string) => Promise<void>;
}

/** Framework-independent application services. Ownership belongs to a session. */
export interface RuntimeServices {
  readonly scheduler: Scheduler;
  readonly artifacts: ArtifactStore;
  readonly metadata?: RuntimeMetadata | undefined;
  readonly search?: SearchIndex | undefined;
  readonly host?: RuntimeHost | undefined;
}

export interface RuntimeSession extends RuntimeServices {
  readonly host: RuntimeHost;
  readonly dispose: () => Promise<void>;
}

/** One resource budget and explicit session ownership per browser workspace. */
export interface RuntimeHost {
  readonly resources: ResourceManager;
  readonly usage: () => Effect.Effect<ArtifactUsage>;
  readonly sessions: () => ReadonlyArray<RuntimeSession>;
  readonly subscribe: (listener: () => void) => () => void;
  readonly attach: (session: RuntimeSession) => () => void;
  readonly dispose: () => Promise<void>;
}

export function createRuntimeHost(resources: ResourceManager): RuntimeHost {
  const sessions = new Set<RuntimeSession>();
  const listeners = new Set<() => void>();
  let snapshot: ReadonlyArray<RuntimeSession> = [];
  const notify = () => {
    snapshot = [...sessions];
    for (const listener of listeners) listener();
  };
  let closing: Promise<void> | undefined;
  return {
    resources,
    usage: () =>
      Effect.gen(function* () {
        const stores = [...new Set([...sessions].map((session) => session.artifacts))];
        const usages = yield* Effect.all(stores.map((store) => store.usage()));
        const byStorage = new Map<string, { storage: string; objects: number; bytes: number }>();
        for (const usage of usages)
          for (const item of usage.byStorage) {
            const sum = byStorage.get(item.storage) ?? {
              storage: item.storage,
              objects: 0,
              bytes: 0,
            };
            sum.objects += item.objects;
            sum.bytes += item.bytes;
            byStorage.set(item.storage, sum);
          }
        return {
          totalObjects: usages.reduce((sum, usage) => sum + usage.totalObjects, 0),
          totalBytes: usages.reduce((sum, usage) => sum + usage.totalBytes, 0),
          byStorage: [...byStorage.values()],
        };
      }),
    sessions: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    attach: (session) => {
      if (closing !== undefined) throw new Error("Runtime host is closed");
      sessions.add(session);
      notify();
      return () => {
        sessions.delete(session);
        notify();
      };
    },
    dispose: () => {
      closing ??= Promise.resolve().then(async () => {
        const results = await Promise.allSettled([...sessions].map((session) => session.dispose()));
        const errors = results.flatMap((result) =>
          result.status === "rejected" ? [result.reason] : [],
        );
        if (errors.length > 0) throw new AggregateError(errors, "Runtime shutdown failed");
      });
      return closing;
    },
  };
}
