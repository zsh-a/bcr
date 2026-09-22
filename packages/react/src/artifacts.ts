import { useCallback, useEffect, useState } from "react";
import { Effect } from "effect";
import type { ArtifactRef, ArtifactUsage } from "@bcr/core";
import { useRuntime } from "./runtime";

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
