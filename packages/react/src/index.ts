import {
  type ArtifactRef,
  type ArtifactStore,
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
