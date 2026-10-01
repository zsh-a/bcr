import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { RuntimeServices } from "@bcr/core";
import { Button, Spinner } from "@bcr/react";
import { clickHouseClient, type ClickHouseConnection } from "./clickhouse-http";
import { loadDisplayNames, namesCacheKey } from "./clickhouse-names";
import {
  displayName,
  EMPTY_DISPLAY_NAMES,
  parseDisplayNames,
  subsetNames,
  type DisplayNames,
} from "./display-names";
import type { ResearchDataset } from "./model";

const NamesContext = createContext<DisplayNames>(EMPTY_DISPLAY_NAMES);
export const useNames = () => useContext(NamesContext);
export function NamesProvider({ names, children }: { names: DisplayNames; children: ReactNode }) {
  return <NamesContext.Provider value={names}>{children}</NamesContext.Provider>;
}
export function Identity({
  code,
  kind = "instruments",
}: {
  code: string;
  kind?: "instruments" | "industries";
}) {
  const name = displayName(useNames(), kind, code);
  return (
    <span className="research-identity">
      <span>{name}</span>
      {name !== code && <small>{code}</small>}
    </span>
  );
}

export function useResearchNames(
  services: RuntimeServices,
  dataset: ResearchDataset | null | undefined,
  connection?: ClickHouseConnection,
) {
  const base = dataset?.manifest.displayNames ?? EMPTY_DISPLAY_NAMES;
  const profile = dataset?.snapshot?.request;
  let cacheKey = "",
    canConnect = false;
  try {
    if (profile) {
      cacheKey = namesCacheKey(profile);
      canConnect = !!connection && namesCacheKey(connection) === cacheKey;
    }
  } catch {
    /* Invalid source metadata can still be displayed using its saved names. */
  }
  const key = `${dataset?.manifestRef.hash ?? dataset?.manifestRef.id ?? ""}:${cacheKey}`;
  const [value, setValue] = useState({
    key: "",
    names: EMPTY_DISPLAY_NAMES,
    loading: false,
    error: "",
  });
  const [refresh, setRefresh] = useState(0);
  const lastRefresh = useRef(0);
  useEffect(() => {
    const abort = new AbortController();
    const force = refresh !== lastRefresh.current;
    lastRefresh.current = refresh;
    const fresh = (names: DisplayNames) => {
      const age = names.capturedAt ? Date.now() - Date.parse(names.capturedAt) : Infinity;
      return age >= 0 && age < 24 * 60 * 60 * 1000;
    };
    const complete = (names: DisplayNames) =>
      dataset &&
      dataset.manifest.instruments.every(({ code }) => Object.hasOwn(names.instruments, code)) &&
      dataset.manifest.industries.every(
        (code) => code === "unknown" || Object.hasOwn(names.industries, code),
      );
    const publish = (names: DisplayNames, loading = false, error = "") => {
      if (!abort.signal.aborted) setValue({ key, names, loading, error });
    };
    publish(base);
    if (!dataset || !cacheKey) return () => abort.abort();
    void (async () => {
      let names = base;
      try {
        const raw = await services.metadata?.get(cacheKey);
        if (raw && raw.length <= 4 * 1024 * 1024) {
          const cached = subsetNames(
            parseDisplayNames(JSON.parse(raw)),
            dataset.manifest.instruments.map((i) => i.code),
            dataset.manifest.industries,
          );
          const cachedNewer =
            Date.parse(cached.capturedAt ?? "1970-01-01") >=
            Date.parse(base.capturedAt ?? "1970-01-01");
          names = {
            ...(cachedNewer ? cached : base),
            instruments: cachedNewer
              ? { ...base.instruments, ...cached.instruments }
              : { ...cached.instruments, ...base.instruments },
            industries: cachedNewer
              ? { ...base.industries, ...cached.industries }
              : { ...cached.industries, ...base.industries },
          };
        }
      } catch {
        /* A damaged name cache does not affect immutable research data. */
      }
      if (abort.signal.aborted) return;
      publish(names);
      if (((complete(names) || fresh(names)) && !force) || !canConnect || !connection) return;
      publish(names, true);
      try {
        const signal = AbortSignal.any([abort.signal, AbortSignal.timeout(15_000)]);
        const loaded = await loadDisplayNames(clickHouseClient(connection), signal);
        signal.throwIfAborted();
        names = subsetNames(
          {
            ...loaded,
            instruments: { ...base.instruments, ...loaded.instruments },
            industries: { ...base.industries, ...loaded.industries },
          },
          dataset.manifest.instruments.map((i) => i.code),
          dataset.manifest.industries,
        );
        // Only the dictionary is saved; snapshots, Arrow partitions and result hashes stay immutable.
        await services.metadata?.set(cacheKey, JSON.stringify(loaded));
        publish(names, false, complete(names) ? "" : "源库中部分名称为空或尚未收录");
      } catch (error) {
        publish(names, false, error instanceof Error ? error.message : String(error));
      }
    })();
    return () => abort.abort();
  }, [
    services,
    dataset,
    key,
    cacheKey,
    canConnect,
    connection?.url,
    connection?.database,
    connection?.user,
    connection?.password,
    refresh,
  ]);
  const current = value.key === key ? value : { names: base, loading: false, error: "" };
  const missing =
    (dataset?.manifest.instruments.filter(
      ({ code }) => !Object.hasOwn(current.names.instruments, code),
    ).length ?? 0) +
    (dataset?.manifest.industries.filter(
      (code) => code !== "unknown" && !Object.hasOwn(current.names.industries, code),
    ).length ?? 0);
  return { ...current, missing, canConnect, reload: () => setRefresh((n) => n + 1) };
}

export function NamesStatus({
  metadata,
  onSettings,
}: {
  metadata: ReturnType<typeof useResearchNames>;
  onSettings: () => void;
}) {
  if (metadata.loading)
    return (
      <p className="research-name-status" role="status">
        <Spinner size="sm" />
        补充证券与行业名称…
      </p>
    );
  const hasNames =
    Object.keys(metadata.names.instruments).length || Object.keys(metadata.names.industries).length;
  if (!metadata.canConnect && !metadata.missing && !metadata.names.capturedAt) return null;
  return (
    <div className="research-name-status">
      <span>
        {metadata.missing
          ? `${metadata.missing} 项名称待补充`
          : metadata.error
            ? "名称更新失败"
            : "名称仅用于展示"}
        {metadata.names.capturedAt && ` · 源库最新记录 ${metadata.names.capturedAt.slice(0, 10)}`}
      </span>
      {metadata.canConnect ? (
        <Button
          variant="ghost"
          size="sm"
          title={metadata.error || "只读取名称，不重新获取行情或运行回测"}
          onClick={metadata.reload}
        >
          {hasNames ? "更新名称" : "补充名称"}
        </Button>
      ) : (
        !hasNames && (
          <Button variant="ghost" size="sm" onClick={onSettings}>
            连接数据源
          </Button>
        )
      )}
    </div>
  );
}
