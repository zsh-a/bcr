import {
  type ArtifactRef,
  type ArtifactStore,
  type ArtifactUsage,
  type ComputeTask,
  type Scheduler,
  type SubmitOptions,
  type TaskHandle,
} from "@bcr/core";
import { Effect, Fiber, Stream } from "effect";
import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

/**
 * React 绑定（架构文档 §12：状态分层——Runtime State 归 Runtime Core，
 * 组件内状态归 React，不建巨型 global store）。
 *
 * 用法：应用启动时用 Layer 构建一次 services（见 examples/demo），
 * 交给 RuntimeProvider；组件内只面对 hooks。
 */
export interface RuntimeServices {
  readonly scheduler: Scheduler;
  readonly artifacts: ArtifactStore;
  /** Optional small-state persistence supplied by the host app's SQLite plane. */
  readonly metadata?: RuntimeMetadata | undefined;
}

export interface RuntimeMetadata {
  readonly get: (key: string) => Promise<string | undefined>;
  readonly set: (key: string, value: string) => Promise<void>;
}

const RuntimeContext = createContext<RuntimeServices | null>(null);

export function RuntimeProvider(props: { services: RuntimeServices; children: ReactNode }) {
  return createElement(RuntimeContext.Provider, { value: props.services }, props.children);
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

export interface TaskState {
  readonly status: "idle" | "running" | "completed" | "failed";
  readonly progress: number;
  readonly outputs?: ReadonlyArray<ArtifactRef> | undefined;
  readonly error?: string | undefined;
}

const idle: TaskState = { status: "idle", progress: 0 };

/** 订阅任务事件流（Stream → React state）。 */
export function useTask(handle: TaskHandle | null): TaskState {
  const [state, setState] = useState<TaskState>(
    handle === null ? idle : { status: "running", progress: 0 },
  );

  useEffect(() => {
    if (handle === null) {
      setState(idle);
      return;
    }
    setState({ status: "running", progress: 0 });
    const fiber = Effect.runFork(
      Stream.runForEach(handle.events, (event) =>
        Effect.sync(() => {
          switch (event.type) {
            case "progress":
              setState((s) => ({ ...s, status: "running", progress: event.value }));
              break;
            case "chunk":
              break;
            case "completed":
              setState({
                status: "completed",
                progress: 1,
                outputs: event.outputs,
              });
              break;
            case "failed":
              setState((s) => ({
                ...s,
                status: "failed",
                error: event.error,
              }));
              break;
          }
        }),
      ),
    );
    return () => {
      Effect.runFork(Fiber.interrupt(fiber));
    };
  }, [handle]);

  return state;
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
  const { artifacts } = useRuntime();
  const [state, setState] = useState<
    Omit<ArtifactUsageState, "refresh"> & { readonly refresh: () => void }
  >({ status: "idle", refresh: () => undefined });
  const [refreshToken, setRefreshToken] = useState(0);
  const refresh = useCallback(() => setRefreshToken((token) => token + 1), []);

  useEffect(() => {
    const unsubscribe = artifacts.subscribe(refresh);
    return unsubscribe;
  }, [artifacts, refresh]);

  useEffect(() => {
    let cancelled = false;
    setState((current) => ({ ...current, status: "loading", error: undefined }));
    const load = () => {
      void Effect.runPromise(artifacts.usage()).then(
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
  }, [artifacts, intervalMs, refresh, refreshToken]);

  return { ...state, refresh };
}
