import { ActionMenu, Dialog, EmptyState, Toast, AppToolbar } from "@bcr/react";
import { Database, Download, FileJson, Search, Table2, Upload, X } from "lucide-react";
import { StatusDot } from "@bcr/react";
import { useRef, useState } from "react";
import { DataTableView, dataColumnTypeLabel } from "./DataTableView";
import { formatBytes } from "./dataFormat";
import { cancelDataTableImport } from "./runtime";
import { useDataWorkspace } from "./useDataWorkspace";
import "./styles.css";

export function App() {
  const [storageOpen, setStorageOpen] = useState(false);
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
    return <div className="data-boot">正在打开数据工作区…</div>;
  }

  return (
    <div
      className="data-studio"
      data-status={status}
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
        const file = event.dataTransfer.files[0];
        if (file !== undefined) void importFile(file);
      }}
    >
      <AppToolbar className="data-header">
        <div className="data-brand">
          <div className="data-brand-mark">
            <Table2 className="data-icon" />
          </div>
          <div>
            <div className="data-brand-title">Data Studio</div>
            <div className="data-brand-subtitle">本地表格工作区</div>
          </div>
        </div>
        <div className="data-header-status">
          <StatusDot status={status === "running" ? "running" : "completed"} /> 本地处理
          <span className="data-status-separator">·</span>
          <span>{status === "running" ? `解析中 ${Math.round(progress * 100)}%` : "已就绪"}</span>
        </div>
        <div className="data-actions">
          <ActionMenu label="更多数据操作">
            <button
              type="button"
              className="ui-btn ui-btn-ghost"
              onClick={() => setStorageOpen(true)}
            >
              存储管理
            </button>
            {table !== null && (
              <>
                <button
                  type="button"
                  className="ui-btn ui-btn-default"
                  onClick={() => exportTable("csv")}
                >
                  <Download className="data-icon" /> CSV
                </button>
                <button
                  type="button"
                  className="ui-btn ui-btn-default"
                  onClick={() => exportTable("json")}
                >
                  <FileJson className="data-icon" /> JSON
                </button>
                <button type="button" className="ui-btn ui-btn-ghost" onClick={() => void clear()}>
                  <X className="data-icon" /> 清除
                </button>
              </>
            )}
          </ActionMenu>
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
              className="ui-btn ui-btn-danger"
              onClick={() => void cancelDataTableImport()}
            >
              <X className="data-icon" /> 取消解析
            </button>
          ) : (
            <button
              type="button"
              className="ui-btn ui-btn-primary"
              onClick={() => inputRef.current?.click()}
            >
              <Upload className="data-icon" /> 导入数据
            </button>
          )}
        </div>
      </AppToolbar>

      <Toast notice={notice} onDismiss={() => setNotice(null)} />

      {assets.length > 1 && (
        <details className="data-asset-catalog" aria-label="数据集列表">
          <summary>
            数据集 · {assets.length}
            <span>{table?.sourceName ?? "选择数据集"}</span>
          </summary>
          <div className="data-catalog-heading">
            <div>
              <span className="ui-section-label data-eyebrow">数据集</span>
              <strong>数据集列表</strong>
            </div>
            <small>{assets.length} 个数据集 · 移除列表引用后仍保留本地文件</small>
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
                      {asset.rowCount.toLocaleString("zh-CN")} 行 · {asset.columnCount} 列 ·{" "}
                      {formatBytes(asset.sizeBytes)}
                      {asset.sampled ? " · 抽样预览" : ""}
                    </small>
                  </span>
                  {active && <span className="data-asset-current">当前</span>}
                </button>
              );
            })}
          </div>
        </details>
      )}

      {storageReport !== null && (
        <Dialog open={storageOpen} onClose={() => setStorageOpen(false)} title="存储管理">
          <section className="data-storage-governance" aria-label="数据存储治理">
            <div className="data-storage-heading">
              <div>
                <span className="ui-section-label data-eyebrow">本地存储</span>
                <strong>清理处理结果</strong>
              </div>
              <button
                type="button"
                className="ui-btn ui-btn-default"
                onClick={() => void cleanupStorage()}
                disabled={
                  storageBusy ||
                  storageReport.orphaned.length === 0 ||
                  services.metadata === undefined
                }
                data-storage-action="reclaim"
              >
                {storageBusy ? "回收中…" : "清理未引用结果"}
              </button>
            </div>
            <div className="data-storage-metrics">
              <div>
                <span>数据占用</span>
                <strong>{formatBytes(storageReport.dataUsage.bytes)}</strong>
                <small>{storageReport.dataUsage.objects} 个文件</small>
              </div>
              <div>
                <span>已保存</span>
                <strong>{storageReport.catalogObjectCount}</strong>
                <small>个数据集</small>
              </div>
              <div>
                <span>可清理</span>
                <strong>{storageReport.orphaned.length}</strong>
                <small>仅当前应用</small>
              </div>
              <div>
                <span>工作区</span>
                <strong>{formatBytes(storageReport.usage.totalBytes)}</strong>
                <small>共 {storageReport.usage.totalObjects} 个文件</small>
              </div>
            </div>
            <small className="data-storage-note">
              仅扫描 <code>data/</code>；当前目录引用与其它工作台 Artifact
              自动受保护。移除资产不会立即删源文件，确认回收后才清理未引用对象。
            </small>
          </section>
        </Dialog>
      )}

      {table === null ? (
        <main className="data-empty-state">
          <EmptyState
            icon={<Database className="data-icon" />}
            title="从一份表格开始"
            description="导入 CSV、JSON 或 NDJSON，搜索、排序并查看字段。数据保存在当前设备。"
            action={
              <button
                type="button"
                className="ui-btn ui-btn-primary ui-btn-lg"
                onClick={() => inputRef.current?.click()}
              >
                <Upload className="data-icon" />
                选择一个数据文件
              </button>
            }
          />
        </main>
      ) : (
        <main className="data-main">
          <div className="data-main-heading">
            <div>
              <p className="ui-section-label data-eyebrow">TABLE / {table.id.slice(-12)}</p>
              <h1 title={table.sourceName}>{table.sourceName}</h1>
              <p className="data-source-line">
                {table.format.toUpperCase()} · {stats?.rowCount.toLocaleString("zh-CN")} 行 ·{" "}
                {stats?.columnCount} 列{table.provenance.sampled ? " · 抽样预览" : ""}
              </p>
            </div>
            <button
              type="button"
              className="ui-btn ui-btn-default"
              aria-label="下载当前表格"
              onClick={() => exportTable("csv")}
            >
              <Download className="data-icon" />
              导出
            </button>
          </div>
          <div className="data-toolbar">
            <label className="data-search-field">
              <Search className="data-icon" />
              <input
                aria-label="搜索数据行"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索数据行…"
              />
              {query.length > 0 && (
                <button
                  type="button"
                  className="ui-btn ui-btn-ghost ui-icon-btn ui-btn-sm"
                  aria-label="清除数据搜索"
                  onClick={() => setQuery("")}
                >
                  <X className="data-icon" />
                </button>
              )}
            </label>
          </div>
          <details className="data-schema-strip" aria-label="数据字段">
            <summary>字段类型 · {table.columns.length}</summary>
            <p className="data-field-summary">
              {stats?.numericColumns} 个数值字段 · {stats?.emptyCells.toLocaleString("zh-CN")}{" "}
              个空值
            </p>
            {table.columns.map((column) => (
              <span key={column.id} className="data-schema-pill">
                <b>{column.name}</b>
                <small>
                  {dataColumnTypeLabel(column.type)} · {column.nullCount} 个空值
                </small>
              </span>
            ))}
          </details>
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
