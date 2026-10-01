import { useState } from "react";
import { ArrowRight, Check, Database, FileUp, RefreshCw } from "lucide-react";
import { Button, Dialog, Input, Spinner } from "@bcr/react";
import type { DataSourceController } from "./useDataSource";

export function ConnectionSettings({
  source,
  open,
  onClose,
  onImport,
  onDemo,
}: {
  source: DataSourceController;
  open: boolean;
  onClose: () => void;
  onImport: () => void;
  onDemo: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const connect = async () => {
    setSaving(true);
    setError(null);
    try {
      if (source.info === null && !(await source.inspect())) return;
      await source.persist();
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setSaving(false);
    }
  };
  const useLocal = async (action?: () => void) => {
    setSaving(true);
    setError(null);
    try {
      await source.useLocal();
      onClose();
      action?.();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setSaving(false);
    }
  };
  return (
    <Dialog
      open={open}
      onClose={() => {
        source.cancelInspect();
        onClose();
      }}
      title="研究数据"
      className="research-source-dialog"
      closeLabel="关闭数据连接"
    >
      <p className="research-dialog-lead">选择下一次运行使用的数据。已有结果会保留。</p>
      <div className="research-source-options" role="group" aria-label="数据来源">
        <button
          type="button"
          aria-pressed={source.kind === "clickhouse"}
          onClick={() => source.choose("clickhouse")}
        >
          <Database size={19} />
          <span>
            <b>ClickHouse</b>
            <small>直连数据库，按区间获取</small>
          </span>
        </button>
        <button
          type="button"
          aria-pressed={source.kind === "local"}
          onClick={() => source.choose("local")}
        >
          <FileUp size={19} />
          <span>
            <b>本地快照</b>
            <small>导入文件，离线重复研究</small>
          </span>
        </button>
      </div>
      {source.kind === "clickhouse" ? (
        <>
          <fieldset disabled={source.testing || saving} className="research-connection-fields">
            <label className="research-field">
              <span>服务器地址</span>
              <Input
                type="url"
                aria-label="ClickHouse 地址"
                value={source.connection.url}
                onChange={(event) => source.updateConnection({ url: event.currentTarget.value })}
              />
            </label>
            <div className="research-field-grid">
              <label className="research-field">
                <span>数据库</span>
                <Input
                  aria-label="ClickHouse 数据库"
                  value={source.connection.database}
                  onChange={(event) =>
                    source.updateConnection({ database: event.currentTarget.value })
                  }
                />
              </label>
              <label className="research-field">
                <span>用户名</span>
                <Input
                  autoComplete="username"
                  aria-label="ClickHouse 用户名"
                  value={source.connection.user}
                  onChange={(event) => source.updateConnection({ user: event.currentTarget.value })}
                />
              </label>
            </div>
            <label className="research-field">
              <span>密码</span>
              <Input
                type="password"
                autoComplete="off"
                aria-label="ClickHouse 密码"
                placeholder="未设置密码时留空"
                value={source.connection.password}
                onChange={(event) =>
                  source.updateConnection({ password: event.currentTarget.value })
                }
              />
            </label>
          </fieldset>
          <div className="research-connection-status" data-connected={source.info !== null}>
            <span>
              {source.info !== null ? (
                <>
                  <Check size={14} />
                  已连接 · 行情至 {source.info.lastDate}
                </>
              ) : (
                "密码仅保留在当前会话"
              )}
            </span>
            <Button
              variant="ghost"
              size="sm"
              disabled={source.testing || saving}
              onClick={() => void source.inspect()}
            >
              {source.testing ? <Spinner size="sm" /> : <RefreshCw size={13} />}测试连接
            </Button>
          </div>
          {(source.error || error) && (
            <p className="research-error" role="alert">
              {source.error ?? error}
            </p>
          )}
          <div className="research-dialog-actions">
            <span>日期范围在工作台中设置。</span>
            <Button
              variant="primary"
              disabled={source.testing || saving}
              onClick={() => void connect()}
            >
              {source.testing || saving ? <Spinner size="sm" /> : <ArrowRight size={15} />}
              连接并使用
            </Button>
          </div>
        </>
      ) : (
        <>
          {error && (
            <p role="alert" className="research-error">
              {error}
            </p>
          )}
          <div className="research-local-choice">
            <b>{source.dataset?.manifest.name ?? "尚未选择本地快照"}</b>
            <p>选择 manifest.json 及其全部 Arrow 文件，或使用演示数据体验。</p>
            <Button onClick={() => void useLocal(onImport)} disabled={saving}>
              <FileUp size={15} />
              导入研究数据
            </Button>
            <Button variant="ghost" onClick={() => void useLocal(onDemo)} disabled={saving}>
              使用演示数据
            </Button>
          </div>
          <div className="research-dialog-actions">
            <span>本地快照无需连接服务器。</span>
            <Button
              variant="primary"
              disabled={!source.dataset || saving}
              onClick={() => void useLocal()}
            >
              使用此快照
            </Button>
          </div>
        </>
      )}
    </Dialog>
  );
}
export function DateRangeSettings({
  source,
  open,
  onClose,
}: {
  source: DataSourceController;
  open: boolean;
  onClose: () => void;
}) {
  const range = source.range;
  const [saving, setSaving] = useState(false),
    [saveError, setSaveError] = useState<string | null>(null);
  const error = source.dateError() ?? saveError;
  const apply = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      await source.persist();
      onClose();
    } catch (caught) {
      setSaveError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setSaving(false);
    }
  };
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
    <Dialog open={open} onClose={onClose} title="回测区间" className="research-range-dialog">
      <p className="research-dialog-lead">以源库可用日期为准，自动补充 30 个预热交易日。</p>
      <div className="research-range-presets">
        <Button size="sm" onClick={() => quick(null)}>
          今年
        </Button>
        <Button size="sm" onClick={() => quick(12)}>
          近一年
        </Button>
        <Button size="sm" onClick={() => quick(36)}>
          近三年
        </Button>
      </div>
      <div className="research-field-grid">
        <label className="research-field">
          <span>开始日期</span>
          <Input
            type="date"
            aria-label="回测开始日期"
            value={range.start}
            max={range.end || undefined}
            onChange={(event) => source.updateRange({ start: event.currentTarget.value })}
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
            onChange={(event) => source.updateRange({ end: event.currentTarget.value })}
          />
        </label>
      </div>
      <div className="research-range-options">
        <label className="research-switch">
          <input
            type="checkbox"
            aria-label="重新获取数据"
            checked={range.refresh}
            onChange={(event) => source.updateRange({ refresh: event.currentTarget.checked })}
          />
          <span>重新获取数据</span>
        </label>
        <p className="research-help">关闭时优先复用相同区间的本地快照。</p>
        <label className="research-switch">
          <input
            type="checkbox"
            aria-label="严格历史数据"
            checked={range.strictPit}
            disabled={
              !source.info?.strictPitReady && source.dataset?.manifest.universeMode !== "historical"
            }
            onChange={(event) => source.updateRange({ strictPit: event.currentTarget.checked })}
          />
          <span>严格历史数据</span>
        </label>
        <p className="research-help">
          {source.info?.strictPitReady
            ? "运行前校验历史成分、财报修订、公司行动与价格限制覆盖。"
            : "源库需提供完整历史合同和已审核的覆盖记录。"}
        </p>
      </div>
      {error && (
        <p className="research-field-error" role="alert">
          {error}
        </p>
      )}
      <div className="research-dialog-actions">
        <span>
          {source.info ? `可用回测日期至 ${source.info.lastBacktestDate}` : "连接后可查看源库覆盖"}
        </span>
        <Button
          variant="primary"
          disabled={source.dateError() !== null || saving}
          onClick={() => void apply()}
        >
          应用区间
        </Button>
      </div>
    </Dialog>
  );
}
