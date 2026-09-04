import {
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
import { useRef } from "react";
import { DataTableView, dataColumnTypeLabel } from "./DataTableView";
import { formatBytes } from "./dataFormat";
import { cancelDataTableImport } from "./runtime";
import { useDataWorkspace } from "./useDataWorkspace";
import "./styles.css";

export function App() {
  const inputRef = useRef<HTMLInputElement>(null);
  const {
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
  } = useDataWorkspace();

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

      {assets.length > 0 && (
        <section className="data-asset-catalog" aria-label="数据资产目录">
          <div className="data-catalog-heading">
            <div>
              <span className="data-eyebrow">WORKSPACE / ASSETS</span>
              <strong>数据资产目录</strong>
            </div>
            <small>
              {assets.length} assets · content addressed · 仅移除目录引用，不删除 Artifact
            </small>
          </div>
          <div className="data-asset-list">
            {assets.map((asset) => {
              const active = asset.id === activeAssetId;
              return (
                <button
                  key={asset.id}
                  type="button"
                  className={`data-asset-card${active ? " is-active" : ""}`}
                  aria-pressed={active}
                  data-asset-id={asset.id}
                  onClick={() => void selectAsset(asset)}
                  disabled={status === "running" || status === "restoring"}
                >
                  <span className="data-asset-format">{asset.format.toUpperCase()}</span>
                  <span className="data-asset-copy">
                    <strong title={asset.sourceName}>{asset.sourceName}</strong>
                    <small>
                      {asset.rowCount.toLocaleString("zh-CN")} rows · {asset.columnCount} cols ·{" "}
                      {formatBytes(asset.sizeBytes)}
                      {asset.sampled ? " · sampled" : ""}
                    </small>
                  </span>
                  {active && <span className="data-asset-current">CURRENT</span>}
                </button>
              );
            })}
          </div>
        </section>
      )}

      {storageReport !== null && (
        <section className="data-storage-governance" aria-label="数据存储治理">
          <div className="data-storage-heading">
            <div>
              <span className="data-eyebrow">STORAGE / GOVERN</span>
              <strong>Artifact 存储治理</strong>
            </div>
            <button
              type="button"
              className="data-button data-button-secondary"
              onClick={() => void cleanupStorage()}
              disabled={
                storageBusy ||
                storageReport.orphaned.length === 0 ||
                services.metadata === undefined
              }
              data-storage-action="reclaim"
            >
              {storageBusy ? "回收中…" : "回收未引用 Artifact"}
            </button>
          </div>
          <div className="data-storage-metrics">
            <div>
              <span>DATA STORE</span>
              <strong>{formatBytes(storageReport.dataUsage.bytes)}</strong>
              <small>{storageReport.dataUsage.objects} objects</small>
            </div>
            <div>
              <span>CATALOG ROOTS</span>
              <strong>{storageReport.catalogObjectCount}</strong>
              <small>protected refs</small>
            </div>
            <div>
              <span>ORPHAN CANDIDATES</span>
              <strong>{storageReport.orphaned.length}</strong>
              <small>data namespace only</small>
            </div>
            <div>
              <span>WORKSPACE</span>
              <strong>{formatBytes(storageReport.usage.totalBytes)}</strong>
              <small>{storageReport.usage.totalObjects} total objects</small>
            </div>
          </div>
          <small className="data-storage-note">
            仅扫描 <code>data/</code>；当前目录引用与其它工作台 Artifact
            自动受保护。移除资产不会立即删源文件，确认回收后才清理未引用对象。
          </small>
        </section>
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
                  {dataColumnTypeLabel(column.type)} · {column.nullCount} empty
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
