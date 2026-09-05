import {
  type ArtifactRef,
  type ArtifactUsage,
  type ComputeTask,
  type SubmitOptions,
  type TaskHandle,
} from "@bcr/core";
import { Effect } from "effect";
import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { ApplicationStatusProvider } from "./application-status";
export type { RuntimeHost, RuntimeMetadata, RuntimeServices, RuntimeSession } from "@bcr/core";
export { usePublishRunningCount, useRunningApps } from "./application-status";

/** Host-shell navigation event used by keep-alive apps without a router provider. */
export const RUNTIME_NAVIGATION_EVENT = "bcr:navigation";

export function notifyNavigation(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(RUNTIME_NAVIGATION_EVENT));
}

export function useLocationSearch(): string {
  const [value, setValue] = useState(() =>
    typeof window === "undefined" ? "" : window.location.search,
  );
  useEffect(() => {
    if (typeof window === "undefined") return;
    const sync = () => setValue(window.location.search);
    window.addEventListener("popstate", sync);
    window.addEventListener(RUNTIME_NAVIGATION_EVENT, sync);
    return () => {
      window.removeEventListener("popstate", sync);
      window.removeEventListener(RUNTIME_NAVIGATION_EVENT, sync);
    };
  }, []);
  return value;
}

/**
 * React 绑定（架构文档 §12：状态分层——Runtime State 归 Runtime Core，
 * 组件内状态归 React，不建巨型 global store）。
 *
 * 用法：应用启动时用 Layer 构建一次 services（见 examples/demo），
 * 交给 RuntimeProvider；组件内只面对 hooks。
 */
import type { RuntimeHost, RuntimeServices, RuntimeSession, TaskSnapshot } from "@bcr/core";

const RuntimeContext = createContext<RuntimeServices | null>(null);
const ActivityContext = createContext(true);
export function RuntimeActivity(props: { active: boolean; children: ReactNode }) {
  return createElement(ActivityContext.Provider, { value: props.active }, props.children);
}
export function useRuntimeActivity(): boolean {
  return useContext(ActivityContext);
}

export function RuntimeProvider(props: { services: RuntimeServices; children: ReactNode }) {
  return createElement(
    RuntimeContext.Provider,
    { value: props.services },
    createElement(ApplicationStatusProvider, { children: props.children }),
  );
}

export function useRuntime(): RuntimeServices {
  const services = useContext(RuntimeContext);
  if (services === null) {
    throw new Error("useRuntime must be used within <RuntimeProvider>");
  }
  return services;
}

/**
 * Optional runtime access for domain apps that can also run in an isolated
 * preview.  The Studio Shell always supplies the shared runtime; standalone
 * previews can keep their local fallback without throwing during render.
 */
export function useOptionalRuntime(): RuntimeServices | null {
  return useContext(RuntimeContext);
}

/** Own a session; inherit the host budget and search from an enclosing workspace. */
export function useRuntimeSession(
  create: (host?: RuntimeHost) => Promise<RuntimeSession>,
  initialize?: (services: RuntimeServices) => Promise<void>,
): { services: RuntimeServices | null; error: string | null } {
  const parent = useOptionalRuntime();
  const host = parent?.host;
  const search = parent?.search;
  const [result, setResult] = useState<{ services: RuntimeServices | null; error: string | null }>({
    services: null,
    error: null,
  });
  const lifetime = useRef<Promise<void>>(Promise.resolve());
  useEffect(() => {
    let cancelled = false;
    let stop!: () => void;
    const stopped = new Promise<void>((resolve) => {
      stop = resolve;
    });
    const previous = lifetime.current;
    setResult({ services: null, error: null });
    lifetime.current = (async () => {
      await previous;
      if (cancelled) return;
      let session: RuntimeSession | undefined;
      try {
        session = await create(host);
        if (cancelled) return;
        const services = { ...session, search: search ?? session.search };
        await initialize?.(services);
        if (!cancelled) {
          setResult({ services, error: null });
          await stopped;
        }
      } catch (error) {
        if (!cancelled)
          setResult({
            services: null,
            error: error instanceof Error ? error.message : String(error),
          });
      } finally {
        await session
          ?.dispose()
          .catch((error: unknown) => console.error("Runtime cleanup failed", error));
      }
    })();
    return () => {
      cancelled = true;
      stop();
    };
  }, [create, initialize, host, search]);
  return result;
}

export function useSubmitTask(): (
  task: ComputeTask,
  options?: SubmitOptions,
) => Promise<TaskHandle> {
  const { scheduler } = useRuntime();
  return useCallback(
    (task, options) => Effect.runPromise(scheduler.submit(task, options)),
    [scheduler],
  );
}

export type TaskState = TaskSnapshot | { readonly status: "idle"; readonly progress: 0 };
const idle: TaskState = { status: "idle", progress: 0 };
const idleSnapshot = () => idle;
const idleSubscribe = () => () => undefined;

export function useTask(handle: TaskHandle | null): TaskState {
  return useSyncExternalStore<TaskState>(
    handle?.state.subscribe ?? idleSubscribe,
    handle?.state.getSnapshot ?? idleSnapshot,
    handle?.state.getSnapshot ?? idleSnapshot,
  );
}

/** 读取 artifact 字节（小对象；大对象请走 getStream）。 */
export function useArtifact(ref: ArtifactRef | null): Uint8Array | undefined {
  const { artifacts } = useRuntime();
  const [data, setData] = useState<Uint8Array | undefined>(undefined);

  useEffect(() => {
    if (ref === null) {
      setData(undefined);
      return;
    }
    let cancelled = false;
    Effect.runPromise(Effect.either(artifacts.get(ref))).then((either) => {
      if (!cancelled) {
        setData(either._tag === "Right" ? either.right : undefined);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [artifacts, ref]);

  return data;
}

export interface ArtifactUsageState {
  readonly status: "idle" | "loading" | "ready" | "error";
  readonly usage?: ArtifactUsage | undefined;
  readonly error?: string | undefined;
  /** 立即触发一次轻量清单刷新。 */
  readonly refresh: () => void;
}

/**
 * 订阅 Runtime 的本地 Artifact 容量。
 *
 * 清单只读取 BinaryStore 的路径和 size，不会把对象内容搬进内存；默认
 * 30 秒轮询一次，足以反映其它 keep-alive App 写入的派生产物；ArtifactStore
 * 自身的 put/delete 事件会立即触发刷新，同时不让顶栏成为高频 IO。调用方
 * 也可用 refresh 在导入或任务完成后主动更新。
 */
export function useArtifactUsage(intervalMs = 30_000): ArtifactUsageState {
  const { artifacts, host } = useRuntime();
  const [state, setState] = useState<
    Omit<ArtifactUsageState, "refresh"> & { readonly refresh: () => void }
  >({ status: "idle", refresh: () => undefined });
  const [refreshToken, setRefreshToken] = useState(0);
  const refresh = useCallback(() => setRefreshToken((token) => token + 1), []);

  useEffect(() => {
    let cleanups: ReadonlyArray<() => void> = [];
    const sync = () => {
      for (const cleanup of cleanups) cleanup();
      const stores = new Set([
        artifacts,
        ...(host?.sessions().map((session) => session.artifacts) ?? []),
      ]);
      cleanups = [...stores].map((store) => store.subscribe(refresh));
      refresh();
    };
    const unsubscribe = host?.subscribe(sync);
    sync();
    return () => {
      unsubscribe?.();
      for (const cleanup of cleanups) cleanup();
    };
  }, [artifacts, host, refresh]);

  useEffect(() => {
    let cancelled = false;
    setState((current) => ({ ...current, status: "loading", error: undefined }));
    const load = () => {
      void Effect.runPromise(host?.usage() ?? artifacts.usage()).then(
        (usage) => {
          if (cancelled) return;
          setState({ status: "ready", usage, refresh });
        },
        (reason: unknown) => {
          if (cancelled) return;
          setState({
            status: "error",
            error: reason instanceof Error ? reason.message : String(reason),
            refresh,
          });
        },
      );
    };
    load();
    const timer = intervalMs > 0 ? window.setInterval(load, intervalMs) : undefined;
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearInterval(timer);
    };
  }, [artifacts, host, intervalMs, refresh, refreshToken]);

  return { ...state, refresh };
}
