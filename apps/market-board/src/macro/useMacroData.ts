import { useCallback, useEffect, useRef, useState } from "react";
import { OpfsStore } from "@bcr/storage-opfs";
import { useRuntimeActivity } from "@bcr/react";
import {
  bundledMacroSnapshot,
  fetchWorldBankSnapshot,
  mergeMacroSnapshots,
  parseMacroSnapshot,
  type MacroSnapshot,
} from "@bcr/market-data/macro";

const cache = new OpfsStore("markets");
const path = "macro/annual.json";
export function useMacroData(countries: string[]) {
  const active = useRuntimeActivity();
  const [snapshot, setSnapshot] = useState<MacroSnapshot>(bundledMacroSnapshot);
  const [refreshing, setRefreshing] = useState(false);
  const [status, setStatus] = useState("内置官方数据快照");
  const [error, setError] = useState("");
  const request = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const current = useRef(snapshot);
  useEffect(() => {
    let disposed = false;
    const initialGeneration = generation.current;
    void cache
      .get(path)
      .then((bytes) => {
        if (!bytes || disposed || generation.current !== initialGeneration) return;
        const restored = parseMacroSnapshot(JSON.parse(new TextDecoder().decode(bytes)));
        const merged = mergeMacroSnapshots(current.current, restored);
        if (
          merged.series.some(
            (series, index) =>
              series.fetchedAt !== current.current.series[index]?.fetchedAt ||
              series.sourceUpdatedAt !== current.current.series[index]?.sourceUpdatedAt,
          )
        ) {
          current.current = merged;
          setSnapshot(merged);
          setStatus("本地保存的官方数据");
        }
      })
      .catch((cause: unknown) => {
        if (import.meta.env.DEV) console.warn("[macro] 本地快照不可用，使用内置快照", cause);
      });
    return () => {
      disposed = true;
      request.current?.abort();
    };
  }, []);
  useEffect(() => {
    if (!active) {
      request.current?.abort();
      setRefreshing(false);
    }
  }, [active]);
  const ids = countries.join(",");
  useEffect(() => {
    request.current?.abort();
    setRefreshing(false);
  }, [ids]);
  const refresh = useCallback(async () => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    generation.current += 1;
    setRefreshing(true);
    setError("");
    try {
      const result = await fetchWorldBankSnapshot(ids.split(","), controller.signal);
      if (controller.signal.aborted) return;
      const next = mergeMacroSnapshots(current.current, result);
      current.current = next;
      setSnapshot(next);
      setStatus("所选国家已在线更新");
      try {
        await cache.put(path, new TextEncoder().encode(JSON.stringify(next)));
        if (!controller.signal.aborted) setStatus("所选国家已更新并保存");
      } catch (cause) {
        if (!controller.signal.aborted) setError("数据已更新，本次未能保存到本地。");
        if (import.meta.env.DEV) console.warn("[macro] 快照保存失败", cause);
      }
    } catch (cause) {
      if (!controller.signal.aborted) {
        setError("暂时无法连接世界银行，正在展示已保存的真实数据。可稍后重试。");
        if (import.meta.env.DEV) console.warn("[macro] 官方数据刷新失败", cause);
      }
    } finally {
      if (request.current === controller) setRefreshing(false);
    }
  }, [ids]);
  return { snapshot, refreshing, refresh, status, error };
}
