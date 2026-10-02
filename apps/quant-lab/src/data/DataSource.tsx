import { Button, Input, Spinner } from "@bcr/react";
import { Check, Database, FileUp, RefreshCw } from "lucide-react";
import type { DataSourceController } from "./useDataSource";

export function DataSettings({
  source,
  disabled,
  onImport,
  onDemo,
}: {
  source: DataSourceController;
  disabled: boolean;
  onImport: () => void;
  onDemo: () => void;
}) {
  const range = source.range;
  const quick = (months: number | null) => {
    const end = source.info?.lastBacktestDate ?? range.end;
    if (!end) return;
    const date = new Date(`${end}T00:00:00Z`);
    if (months === null) date.setUTCMonth(0, 1);
    else date.setUTCMonth(date.getUTCMonth() - months);
    const first = date.toISOString().slice(0, 10);
    source.updateRange({
      start: source.info && first < source.info.firstDate ? source.info.firstDate : first,
      end,
    });
  };
  return (
    <fieldset className="research-data-settings" disabled={disabled || source.testing}>
      <div className="research-source-options" role="group" aria-label="数据来源">
        <button
          type="button"
          aria-pressed={source.kind === "clickhouse"}
          onClick={() => source.choose("clickhouse")}
        >
          <Database size={16} />
          <span>
            <b>ClickHouse</b>
            <small>数据库直连</small>
          </span>
        </button>
        <button
          type="button"
          aria-pressed={source.kind === "local"}
          onClick={() => source.choose("local")}
        >
          <FileUp size={16} />
          <span>
            <b>本地快照</b>
            <small>离线研究</small>
          </span>
        </button>
      </div>
      {source.kind === "clickhouse" ? (
        <>
          <label className="research-field">
            <span>服务器地址</span>
            <Input
              type="url"
              aria-label="ClickHouse 地址"
              value={source.connection.url}
              onChange={(e) => source.updateConnection({ url: e.currentTarget.value })}
            />
          </label>
          <div className="research-field-grid">
            <label className="research-field">
              <span>数据库</span>
              <Input
                aria-label="ClickHouse 数据库"
                value={source.connection.database}
                onChange={(e) => source.updateConnection({ database: e.currentTarget.value })}
              />
            </label>
            <label className="research-field">
              <span>用户名</span>
              <Input
                aria-label="ClickHouse 用户名"
                autoComplete="username"
                value={source.connection.user}
                onChange={(e) => source.updateConnection({ user: e.currentTarget.value })}
              />
            </label>
          </div>
          <label className="research-field">
            <span>密码</span>
            <Input
              aria-label="ClickHouse 密码"
              type="password"
              autoComplete="off"
              placeholder="仅用于当前会话"
              value={source.connection.password}
              onChange={(e) => source.updateConnection({ password: e.currentTarget.value })}
            />
          </label>
          <div className="research-connection-status" data-connected={source.info !== null}>
            <span>
              {source.info ? (
                <>
                  <Check size={14} />
                  已连接 · 行情至 {source.info.lastDate}
                </>
              ) : (
                "密码不会保存到本地"
              )}
            </span>
            <Button variant="ghost" size="sm" onClick={() => void source.inspect()}>
              {source.testing ? <Spinner size="sm" /> : <RefreshCw size={13} />}测试连接
            </Button>
          </div>
          {source.error && (
            <p className="research-error" role="alert">
              {source.error}
            </p>
          )}
          <div className="research-setting-section">
            <div className="research-setting-section-title">
              <h3>回测区间</h3>
              <div className="research-range-presets">
                <Button size="sm" variant="ghost" onClick={() => quick(null)}>
                  今年
                </Button>
                <Button size="sm" variant="ghost" onClick={() => quick(12)}>
                  1 年
                </Button>
                <Button size="sm" variant="ghost" onClick={() => quick(36)}>
                  3 年
                </Button>
              </div>
            </div>
            <div className="research-field-grid">
              <label className="research-field">
                <span>开始日期</span>
                <Input
                  type="date"
                  aria-label="回测开始日期"
                  value={range.start}
                  max={range.end || undefined}
                  onChange={(e) => source.updateRange({ start: e.currentTarget.value })}
                />
              </label>
              <label className="research-field">
                <span>结束日期</span>
                <Input
                  type="date"
                  aria-label="回测结束日期"
                  value={range.end}
                  min={range.start || undefined}
                  max={source.info?.lastBacktestDate}
                  onChange={(e) => source.updateRange({ end: e.currentTarget.value })}
                />
              </label>
            </div>
            <p className="research-help">按交易日对齐，自动补充 30 个预热交易日。</p>
            {source.dateError() && (
              <p className="research-field-error" role="alert">
                {source.dateError()}
              </p>
            )}
          </div>
          <details className="research-parameter-details">
            <summary>数据获取与历史覆盖</summary>
            <label className="research-switch">
              <input
                type="checkbox"
                aria-label="重新获取数据"
                checked={range.refresh}
                onChange={(e) => source.updateRange({ refresh: e.currentTarget.checked })}
              />
              <span>重新获取数据</span>
            </label>
            <p className="research-help">
              默认复用本地快照；重新获取会更新源数据，历史运行保留原快照。
            </p>
            <label className="research-switch">
              <input
                type="checkbox"
                aria-label="严格历史数据"
                checked={range.strictPit}
                disabled={
                  !source.info?.strictPitReady &&
                  source.dataset?.manifest.universeMode !== "historical"
                }
                onChange={(e) => source.updateRange({ strictPit: e.currentTarget.checked })}
              />
              <span>严格历史数据</span>
            </label>
            <p className="research-help">校验历史成分、财报修订、公司行动和价格限制的完整覆盖。</p>
          </details>
        </>
      ) : (
        <div className="research-local-choice">
          <b>{source.dataset?.manifest.name ?? "选择一份研究快照"}</b>
          <p>导入 manifest.json 和全部 Arrow 分片，或使用演示数据。</p>
          <Button onClick={onImport}>
            <FileUp size={15} />
            导入研究数据
          </Button>
          <Button variant="ghost" onClick={onDemo}>
            使用演示数据
          </Button>
        </div>
      )}
    </fieldset>
  );
}
