import {
  ArrowDownAZ,
  ArrowUpAZ,
  Check,
  Database,
  Download,
  FileJson,
  Filter,
  Search,
  Table2,
  Upload,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { SearchDocument } from "@bcr/core";
import { useLocationSearch, useOptionalRuntime } from "@bcr/react";
import {
  dataTableStats,
  type DataCell,
  type DataColumnType,
  type DataTablePackage,
} from "@bcr/data-core";
import {
  cancelDataTableImport,
  clearDataTable,
  importDataTable,
  restoreDataTable,
  type DataTableSnapshot,
} from "./runtime";
import "./styles.css";

type LoadState = "restoring" | "idle" | "running" | "ready" | "error";

function formatCell(value: DataCell): string {
  if (value === null) return "—";
  if (typeof value === "number") return value.toLocaleString("zh-CN", { maximumFractionDigits: 6 });
  return String(value);
}

function typeLabel(type: DataColumnType): string {
  if (type === "number") return "NUMBER";
  if (type === "boolean") return "BOOL";
  if (type === "date") return "DATE";
  if (type === "null") return "EMPTY";
  return "TEXT";
}

function escapeCsv(value: DataCell): string {
  const text = value === null ? "" : String(value);
  return /[",\n\r]/u.test(text) ? `"${text.replace(/"/gu, '""')}"` : text;
}

function download(text: string, name: string, mime: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 500);
}

function tableSearchDocument(table: DataTablePackage): SearchDocument {
  const stats = dataTableStats(table);
  const preview = table.rows
    .slice(0, 24)
    .flatMap((row) => row.map((value) => (value === null ? "" : String(value))))
    .join(" ")
    .slice(0, 24_000);
  return {
    id: `data:table:${table.id}`,
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

function DataTableView(props: {
  readonly table: DataTablePackage;
  readonly query: string;
  readonly sortColumn: number | null;
  readonly sortDirection: "asc" | "desc";
  readonly onSort: (column: number) => void;
}) {
  const filteredRows = useMemo(() => {
    const normalized = props.query.trim().toLocaleLowerCase();
    const rows = props.table.rows.filter((row) => {
      if (normalized.length === 0) return true;
      return row.some((value) => formatCell(value).toLocaleLowerCase().includes(normalized));
    });
    if (props.sortColumn === null) return rows;
    const column = props.sortColumn;
    return [...rows].sort((left, right) => {
      const a = left[column];
      const b = right[column];
      const av = a === null ? "" : a;
      const bv = b === null ? "" : b;
      const result =
        typeof av === "number" && typeof bv === "number"
          ? av - bv
          : String(av).localeCompare(String(bv), "zh-CN", { numeric: true, sensitivity: "base" });
      return props.sortDirection === "asc" ? result : -result;
    });
  }, [props]);
  const visible = filteredRows.slice(0, 250);
  return (
    <div className="data-table-frame">
      <div className="data-table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              <th className="data-row-number">#</th>
              {props.table.columns.map((column, index) => {
                const active = props.sortColumn === index;
                return (
                  <th
                    key={column.id}
                    aria-sort={
                      active ? (props.sortDirection === "asc" ? "ascending" : "descending") : "none"
                    }
                  >
                    <button
                      type="button"
                      className="data-column-button"
                      onClick={() => props.onSort(index)}
                    >
                      <span>
                        {column.name}
                        <small>{typeLabel(column.type)}</small>
                      </span>
                      {active ? (
                        props.sortDirection === "asc" ? (
                          <ArrowDownAZ className="data-icon" />
                        ) : (
                          <ArrowUpAZ className="data-icon" />
                        )
                      ) : (
                        <span className="data-sort-placeholder">↕</span>
                      )}
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {visible.map((row, rowIndex) => (
              <tr key={`${rowIndex}-${row.map((value) => String(value)).join("|")}`}>
                <td className="data-row-number">{rowIndex + 1}</td>
                {props.table.columns.map((column, columnIndex) => (
                  <td key={column.id} className={column.type === "number" ? "is-number" : ""}>
                    {formatCell(row[columnIndex] ?? null)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="data-table-footer">
        <span>
          {filteredRows.length.toLocaleString("zh-CN")} matching rows · showing {visible.length}
        </span>
        {filteredRows.length > visible.length && <span>Preview capped at 250 rows</span>}
      </div>
    </div>
  );
}

export function App() {
  const services = useOptionalRuntime();
  const routeSearch = useLocationSearch();
  const [snapshot, setSnapshot] = useState<DataTableSnapshot | null>(null);
  const [status, setStatus] = useState<LoadState>("restoring");
  const [progress, setProgress] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [sortColumn, setSortColumn] = useState<number | null>(null);
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");
  const inputRef = useRef<HTMLInputElement>(null);

  // Search results deep-link to `/data?query=...`. Keep the query in local
  // React state so typing remains instant, while still reacting when the
  // keep-alive shell changes the URL without remounting this app.
  useEffect(() => {
    const queryFromRoute = new URLSearchParams(routeSearch).get("query") ?? "";
    setQuery(queryFromRoute);
  }, [routeSearch]);

  useEffect(() => {
    if (services === null) return;
    let cancelled = false;
    void restoreDataTable(services).then((restored) => {
      if (cancelled) return;
      setSnapshot(restored ?? null);
      setStatus(restored === undefined ? "idle" : "ready");
      setProgress(restored === undefined ? 0 : 1);
    });
    return () => {
      cancelled = true;
    };
  }, [services]);

  useEffect(() => {
    if (services?.search === undefined) return;
    services.search.replaceSource(
      "data",
      snapshot === null ? [] : [tableSearchDocument(snapshot.table)],
    );
  }, [services?.search, snapshot]);

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
    if (format === "json") {
      download(
        JSON.stringify(table, null, 2),
        `${table.sourceName}.table.json`,
        "application/json",
      );
      setNotice("Canonical table JSON 已导出");
      return;
    }
    const csv = [
      table.columns.map((column) => escapeCsv(column.name)).join(","),
      ...table.rows.map((row) => row.map(escapeCsv).join(",")),
    ].join("\n");
    download(csv, `${table.sourceName}.preview.csv`, "text/csv;charset=utf-8");
    setNotice("CSV 预览已导出");
  };

  const clear = async (): Promise<void> => {
    if (services === null) return;
    await clearDataTable(services);
    setSnapshot(null);
    setStatus("idle");
    setProgress(0);
    setQuery("");
    setNotice("已清除当前 Data Studio 快照；原始 Artifact 仍保留在本地存储");
  };

  if (services === null) {
    return <div className="data-boot">DATA STUDIO · CONNECTING TO RUNTIME</div>;
  }

  return (
    <div
      className="data-studio"
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
        const file = event.dataTransfer.files[0];
        if (file !== undefined) void importFile(file);
      }}
    >
      <header className="data-header">
        <div className="data-brand">
          <div className="data-brand-mark">
            <Table2 className="data-icon" />
          </div>
          <div>
            <div className="data-brand-title">
              BCR <span>/</span> Data Studio
            </div>
            <div className="data-brand-subtitle">LOCAL TABLE EXPLORER · CANONICAL ARTIFACTS</div>
          </div>
        </div>
        <div className="data-header-status">
          <span className="data-live-dot" /> LOCAL-FIRST
          <span className="data-status-separator">·</span>
          <span>
            {status === "running" ? `PARSING ${Math.round(progress * 100)}%` : "RUNTIME READY"}
          </span>
        </div>
        <div className="data-actions">
          <input
            ref={inputRef}
            className="data-hidden-input"
            type="file"
            accept=".csv,.json,.ndjson,.jsonl,text/csv,application/json"
            aria-label="导入数据文件"
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              event.currentTarget.value = "";
              if (file !== undefined) void importFile(file);
            }}
          />
          {status === "running" ? (
            <button
              type="button"
              className="data-button data-button-danger"
              onClick={() => void cancelDataTableImport()}
            >
              <X className="data-icon" /> 取消解析
            </button>
          ) : (
            <button
              type="button"
              className="data-button data-button-primary"
              onClick={() => inputRef.current?.click()}
            >
              <Upload className="data-icon" /> 导入数据
            </button>
          )}
        </div>
      </header>

      {notice !== null && (
        <div className="data-notice" role="status" aria-live="polite">
          <Check className="data-icon" />
          <span>{notice}</span>
          <button type="button" aria-label="关闭提示" onClick={() => setNotice(null)}>
            <X className="data-icon" />
          </button>
        </div>
      )}

      {table === null ? (
        <main className="data-empty-state">
          <div className="data-empty-icon">
            <Database className="data-icon" />
          </div>
          <p className="data-eyebrow">DATA / 01 · SCHEMA FIRST</p>
          <h1>
            把表格留在本地，
            <br />
            让数据先变得可理解。
          </h1>
          <p>
            拖入 CSV、JSON 数组或 NDJSON。解析在共享 Worker 中完成，原始文件和版本化表格 Artifact
            都保存在当前设备。
          </p>
          <button
            type="button"
            className="data-button data-button-primary data-empty-button"
            onClick={() => inputRef.current?.click()}
          >
            <Upload className="data-icon" /> 选择一个数据文件
          </button>
          <span className="data-empty-hint">CSV · JSON · NDJSON · PREVIEW 250 ROWS</span>
        </main>
      ) : (
        <main className="data-main">
          <div className="data-main-heading">
            <div>
              <p className="data-eyebrow">TABLE / {table.id.slice(-12)}</p>
              <h1>{table.sourceName}</h1>
              <p className="data-source-line">
                {table.format.toUpperCase()} ·{" "}
                {table.provenance.sampled ? "SAMPLED PREVIEW" : "FULL INPUT"} ·{" "}
                {table.provenance.adapter}
              </p>
            </div>
            <div className="data-export-actions">
              <button
                type="button"
                className="data-button data-button-secondary"
                onClick={() => exportTable("csv")}
              >
                <Download className="data-icon" /> CSV
              </button>
              <button
                type="button"
                className="data-button data-button-secondary"
                onClick={() => exportTable("json")}
              >
                <FileJson className="data-icon" /> JSON
              </button>
              <button
                type="button"
                className="data-button data-button-quiet"
                onClick={() => void clear()}
              >
                <X className="data-icon" /> 清除
              </button>
            </div>
          </div>
          <div className="data-stat-grid">
            <div className="data-stat">
              <span>ROWS</span>
              <strong>{stats?.rowCount.toLocaleString("zh-CN")}</strong>
              <small>{table.provenance.sampled ? "preview rows" : "records"}</small>
            </div>
            <div className="data-stat">
              <span>COLUMNS</span>
              <strong>{stats?.columnCount}</strong>
              <small>typed fields</small>
            </div>
            <div className="data-stat">
              <span>NUMERIC</span>
              <strong>{stats?.numericColumns}</strong>
              <small>measure columns</small>
            </div>
            <div className="data-stat">
              <span>EMPTY CELLS</span>
              <strong>{stats?.emptyCells.toLocaleString("zh-CN")}</strong>
              <small>missing values</small>
            </div>
          </div>
          <div className="data-toolbar">
            <label className="data-search-field">
              <Search className="data-icon" />
              <input
                aria-label="搜索数据行"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search across rows…"
              />
              {query.length > 0 && (
                <button type="button" aria-label="清除数据搜索" onClick={() => setQuery("")}>
                  <X className="data-icon" />
                </button>
              )}
            </label>
            <div className="data-toolbar-meta">
              <Filter className="data-icon" /> schema locked · click a column to sort
            </div>
          </div>
          <div className="data-schema-strip" aria-label="数据字段">
            {table.columns.map((column) => (
              <span key={column.id} className="data-schema-pill">
                <b>{column.name}</b>
                <small>
                  {typeLabel(column.type)} · {column.nullCount} empty
                </small>
              </span>
            ))}
          </div>
          <DataTableView
            table={table}
            query={query}
            sortColumn={sortColumn}
            sortDirection={sortDirection}
            onSort={selectSort}
          />
        </main>
      )}
    </div>
  );
}
