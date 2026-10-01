import { useEffect, useRef, useState } from "react";
import type { RuntimeServices } from "@bcr/core";
import { inspectFromBrowser } from "./clickhouse-browser";
import {
  DEFAULT_CONNECTION,
  numericDate,
  publicProfile,
  type ClickHouseConnection,
  type ClickHouseInfo,
  type ClickHouseProfile,
  type ClickHouseRange,
} from "./clickhouse-http";
import type { ResearchDataset } from "./model";
import { readMarketProfile, saveMarketProfile } from "@bcr/market-data/research/catalog";

export function useDataSource(services: RuntimeServices, dataset: ResearchDataset | null) {
  const [connection, setConnection] = useState<ClickHouseConnection>({ ...DEFAULT_CONNECTION });
  const [range, setRange] = useState<ClickHouseRange>({
    start: "",
    end: "",
    strictPit: false,
    refresh: false,
  });
  const [kind, setKind] = useState<"local" | "clickhouse">("local");
  const [restored, setRestored] = useState(false);
  const [info, setInfo] = useState<ClickHouseInfo | null>(null);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const latest = useRef({ connection, range, kind });
  const controller = useRef<AbortController | null>(null);
  const dateEdited = useRef(false);
  const edited = useRef(false);
  useEffect(() => {
    let disposed = false;
    void (async () => {
      try {
        const [raw, choice] = await Promise.all([
          services.metadata?.get("jsg-clickhouse-profile-v1"),
          services.metadata?.get("jsg-source-choice"),
        ]);
        if (disposed || edited.current) return;
        if (raw !== undefined) {
          const profile = JSON.parse(raw) as ClickHouseProfile;
          const safe = publicProfile({ ...profile, password: "" }, { ...profile, refresh: false });
          numericDate(safe.start);
          numericDate(safe.end);
          setConnection({ url: safe.url, database: safe.database, user: safe.user, password: "" });
          setRange({ start: safe.start, end: safe.end, strictPit: safe.strictPit, refresh: false });
          latest.current.connection = {
            url: safe.url,
            database: safe.database,
            user: safe.user,
            password: "",
          };
          latest.current.range = {
            start: safe.start,
            end: safe.end,
            strictPit: safe.strictPit,
            refresh: false,
          };
          dateEdited.current = true;
        }
        const shared = readMarketProfile();
        if (shared) {
          setConnection({
            url: shared.url,
            database: shared.database,
            user: shared.user,
            password: "",
          });
          setRange({
            start: shared.start,
            end: shared.end,
            strictPit: shared.strictPit,
            refresh: false,
          });
          latest.current.connection = {
            url: shared.url,
            database: shared.database,
            user: shared.user,
            password: "",
          };
          latest.current.range = {
            start: shared.start,
            end: shared.end,
            strictPit: shared.strictPit,
            refresh: false,
          };
          dateEdited.current = true;
        }
        if (choice === "clickhouse" || choice === "local") {
          setKind(choice);
          latest.current.kind = choice;
        } else if (raw !== undefined) {
          setKind("clickhouse");
          latest.current.kind = "clickhouse";
        }
      } catch {
        /* a malformed profile does not prevent local research */
      } finally {
        if (!disposed) setRestored(true);
      }
    })();
    return () => {
      disposed = true;
      controller.current?.abort();
    };
  }, [services]);
  const updateConnection = (patch: Partial<ClickHouseConnection>) => {
    edited.current = true;
    latest.current.connection = { ...latest.current.connection, ...patch };
    setConnection(latest.current.connection);
    setInfo(null);
    setError(null);
  };
  const updateRange = (patch: Partial<ClickHouseRange>) => {
    edited.current = true;
    dateEdited.current = true;
    latest.current.range = { ...latest.current.range, ...patch };
    setRange(latest.current.range);
    setError(null);
  };
  const choose = (value: "local" | "clickhouse") => {
    edited.current = true;
    latest.current.kind = value;
    setKind(value);
  };
  const inspect = async (): Promise<boolean> => {
    if (controller.current !== null) return false;
    const abort = new AbortController();
    controller.current = abort;
    setTesting(true);
    setError(null);
    try {
      const result = await inspectFromBrowser(latest.current.connection, abort.signal);
      abort.signal.throwIfAborted();
      setInfo(result);
      if (!dateEdited.current)
        latest.current.range = {
          ...latest.current.range,
          start:
            `${result.lastBacktestDate.slice(0, 4)}-01-01` > result.firstDate
              ? `${result.lastBacktestDate.slice(0, 4)}-01-01`
              : result.firstDate,
          end: result.lastBacktestDate,
        };
      if (!result.strictPitReady)
        latest.current.range = { ...latest.current.range, strictPit: false };
      setRange(latest.current.range);
      return true;
    } catch (caught) {
      if (!abort.signal.aborted)
        setError(caught instanceof Error ? caught.message : String(caught));
      return false;
    } finally {
      controller.current = null;
      setTesting(false);
    }
  };
  const persist = async () => {
    const profile = latest.current;
    if (profile.kind === "clickhouse") saveMarketProfile(profile.connection, profile.range);
    await services.metadata?.set("jsg-source-choice", profile.kind);
    if (profile.kind === "clickhouse")
      await services.metadata?.set(
        "jsg-clickhouse-profile-v1",
        JSON.stringify(publicProfile(profile.connection, profile.range)),
      );
  };
  const useLocal = async () => {
    choose("local");
    await services.metadata?.set("jsg-source-choice", "local");
  };
  const dateError = () => {
    if (kind !== "clickhouse") return null;
    try {
      numericDate(range.start);
      numericDate(range.end);
      if (range.start > range.end) return "开始日期应早于结束日期";
      if (info && range.end > info.lastBacktestDate)
        return `可用回测日期截至 ${info.lastBacktestDate}`;
      return null;
    } catch {
      return "请选择有效的回测日期";
    }
  };
  return {
    connection,
    range,
    kind,
    restored,
    info,
    testing,
    error,
    dataset,
    updateConnection,
    updateRange,
    choose,
    inspect,
    persist,
    useLocal,
    dateError,
    cancelInspect: () => controller.current?.abort(),
  };
}
export type DataSourceController = ReturnType<typeof useDataSource>;
