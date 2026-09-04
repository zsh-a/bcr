import type { SearchDocument } from "@bcr/core";
import { dataTableStats, type DataTablePackage } from "@bcr/data-core";
import { useLocationSearch, useOptionalRuntime } from "@bcr/react";
import { useEffect, useState } from "react";
import { downloadDataTable, formatBytes, tableSearchPreview } from "./dataFormat";
import {
  activateDataAsset,
  clearDataTable,
  importDataTable,
  inspectDataStorage,
  reclaimDataStorage,
  removeDataAsset,
  restoreDataCatalog,
  type DataAssetRecord,
  type DataStorageReport,
  type DataTableSnapshot,
} from "./runtime";

type LoadState = "restoring" | "idle" | "running" | "ready" | "error";

function assetSearchDocument(asset: DataAssetRecord, table?: DataTablePackage): SearchDocument {
  const preview = table === undefined ? "" : tableSearchPreview(table);
  return {
    id: `data:table:${asset.id}`,
    source: "data",
    kind: "dataset",
    title: asset.sourceName,
    subtitle: `${asset.format.toUpperCase()} · ${asset.rowCount.toLocaleString("zh-CN")} rows · ${asset.columnCount} columns`,
    ...(preview.length === 0 ? {} : { body: preview }),
    tags: ["data", asset.format, ...(table?.columns.map((column) => column.name) ?? [])],
    route: "/data",
    updatedAt: asset.lastOpenedAt,
  };
}

function tableSearchDocument(table: DataTablePackage, assetId = table.id): SearchDocument {
  const stats = dataTableStats(table);
  const preview = tableSearchPreview(table);
  return {
    id: `data:table:${assetId}`,
    source: "data",
    kind: "dataset",
    title: table.sourceName,
    subtitle: `${table.format.toUpperCase()} · ${stats.rowCount.toLocaleString("zh-CN")} rows · ${stats.columnCount} columns`,
    ...(preview.length === 0 ? {} : { body: preview }),
    tags: ["data", table.format, ...table.columns.map((column) => column.name)],
    route: "/data",
    updatedAt: table.provenance.createdAt,
  };
}

export function useDataWorkspace() {
  const services = useOptionalRuntime();
  const routeSearch = useLocationSearch();
  const [snapshot, setSnapshot] = useState<DataTableSnapshot | null>(null);
  const [assets, setAssets] = useState<ReadonlyArray<DataAssetRecord>>([]);
  const [activeAssetId, setActiveAssetId] = useState<string | null>(null);
  const [status, setStatus] = useState<LoadState>("restoring");
  const [progress, setProgress] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [sortColumn, setSortColumn] = useState<number | null>(null);
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");
  const [storageReport, setStorageReport] = useState<DataStorageReport | null>(null);
  const [storageBusy, setStorageBusy] = useState(false);

  useEffect(() => {
    setQuery(new URLSearchParams(routeSearch).get("query") ?? "");
  }, [routeSearch]);

  useEffect(() => {
    if (services === null) return;
    let cancelled = false;
    void restoreDataCatalog(services).then((restored) => {
      if (cancelled) return;
      setAssets(restored.catalog.assets);
      setActiveAssetId(restored.catalog.activeAssetId);
      setSnapshot(restored.active ?? null);
      setStatus(restored.active === undefined ? "idle" : "ready");
      setProgress(restored.active === undefined ? 0 : 1);
      if (restored.active === undefined && restored.catalog.assets.length > 0) {
        setNotice("资产目录已恢复，但当前表格 Artifact 不可用；可重新导入或运行存储治理");
      }
    });
    return () => {
      cancelled = true;
    };
  }, [services]);

  useEffect(() => {
    if (services === null) return;
    let cancelled = false;
    void inspectDataStorage(services).then((report) => {
      if (!cancelled) setStorageReport(report);
    });
    return () => {
      cancelled = true;
    };
  }, [assets, services]);

  useEffect(() => {
    if (services?.search === undefined) return;
    services.search.replaceSource(
      "data",
      assets.map((asset) =>
        snapshot?.asset?.id === asset.id
          ? tableSearchDocument(snapshot.table, asset.id)
          : assetSearchDocument(asset),
      ),
    );
  }, [assets, services?.search, snapshot]);

  const table = snapshot?.table ?? null;
  const stats = table === null ? null : dataTableStats(table);

  const selectSort = (column: number): void => {
    if (sortColumn === column) {
      setSortDirection((value) => (value === "asc" ? "desc" : "asc"));
    } else {
      setSortColumn(column);
      setSortDirection("asc");
    }
  };

  const selectAsset = async (asset: DataAssetRecord): Promise<void> => {
    if (services === null || asset.id === activeAssetId) return;
    setStatus("restoring");
    setNotice(null);
    try {
      const next = await activateDataAsset(services, asset.id);
      if (next === undefined) throw new Error(`${asset.sourceName} 的 table Artifact 不可用`);
      const opened = next.asset ?? asset;
      setSnapshot(next);
      setAssets((current) => [
        opened,
        ...current.filter((candidate) => candidate.id !== opened.id),
      ]);
      setActiveAssetId(opened.id);
      setStatus("ready");
      setProgress(1);
      setQuery("");
      setSortColumn(null);
      setNotice(`已切换到 ${opened.sourceName}`);
    } catch (reason) {
      setStatus("error");
      setNotice(reason instanceof Error ? reason.message : String(reason));
    }
  };

  const importFile = async (file: File): Promise<void> => {
    if (services === null) return;
    setStatus("running");
    setProgress(0);
    setNotice(null);
    setQuery("");
    setSortColumn(null);
    try {
      const next = await importDataTable(services, file, setProgress);
      setSnapshot(next);
      if (next.asset !== undefined) {
        setAssets((current) => [
          next.asset!,
          ...current.filter((asset) => asset.id !== next.asset!.id),
        ]);
        setActiveAssetId(next.asset.id);
      }
      setStatus("ready");
      setProgress(1);
      setNotice(`${file.name} 已解析并写入本地 Artifact`);
    } catch (reason) {
      setStatus("error");
      setNotice(reason instanceof Error ? reason.message : String(reason));
    }
  };

  const exportTable = (format: "csv" | "json"): void => {
    if (table === null) return;
    downloadDataTable(table, format);
    setNotice(format === "json" ? "Canonical table JSON 已导出" : "CSV 预览已导出");
  };

  const clear = async (): Promise<void> => {
    if (services === null) return;
    const currentId = activeAssetId ?? snapshot?.asset?.id;
    if (currentId === null || currentId === undefined) {
      await clearDataTable(services);
      setSnapshot(null);
      setStatus("idle");
      setProgress(0);
      setQuery("");
      setNotice("已清除当前 Data Studio 快照；原始 Artifact 仍保留在本地存储");
      return;
    }
    const catalog = await removeDataAsset(services, currentId);
    setAssets(catalog.assets);
    setActiveAssetId(catalog.activeAssetId);
    setQuery("");
    setSortColumn(null);
    if (catalog.activeAssetId !== null) {
      const nextAsset = catalog.assets.find((asset) => asset.id === catalog.activeAssetId);
      if (nextAsset !== undefined) {
        const next = await activateDataAsset(services, nextAsset.id);
        if (next !== undefined) {
          setSnapshot(next);
          setAssets((current) => [
            next.asset ?? nextAsset,
            ...current.filter((asset) => asset.id !== nextAsset.id),
          ]);
          setStatus("ready");
          setProgress(1);
          setNotice(`已移除当前资产，切换到 ${nextAsset.sourceName}；Artifact 仍保留在本地存储`);
          return;
        }
      }
    }
    setSnapshot(null);
    setStatus("idle");
    setProgress(0);
    setNotice("已从资产目录移除当前数据；原始 Artifact 仍保留在本地存储");
  };

  const cleanupStorage = async (): Promise<void> => {
    if (services === null || storageReport === null || storageReport.orphaned.length === 0) return;
    if (
      typeof window !== "undefined" &&
      !window.confirm(
        `确认回收 ${storageReport.orphaned.length} 个未引用 Data Artifact（${formatBytes(
          storageReport.orphaned.reduce((total, entry) => total + entry.size, 0),
        )}）？目录中的资产和其它工作台对象不会被删除。`,
      )
    ) {
      return;
    }
    setStorageBusy(true);
    try {
      const result = await reclaimDataStorage(services, storageReport.plan);
      setStorageReport(await inspectDataStorage(services));
      setNotice(
        result.deleted.length === 0
          ? `没有回收对象（${result.skipped.length} 个对象在计划执行前已变化或受保护）`
          : `已回收 ${result.deleted.length} 个未引用 Data Artifact，释放 ${formatBytes(result.reclaimedBytes)}`,
      );
    } catch (reason) {
      setNotice(`存储治理失败：${reason instanceof Error ? reason.message : String(reason)}`);
    } finally {
      setStorageBusy(false);
    }
  };

  return {
    services,
    table,
    stats,
    assets,
    activeAssetId,
    status,
    progress,
    notice,
    setNotice,
    query,
    setQuery,
    sortColumn,
    sortDirection,
    storageReport,
    storageBusy,
    selectSort,
    selectAsset,
    importFile,
    exportTable,
    clear,
    cleanupStorage,
  };
}
