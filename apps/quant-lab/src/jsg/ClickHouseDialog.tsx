import { Database, ArrowRight, Check, LoaderCircle, RefreshCw, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import type { RuntimeServices } from "@bcr/core";
import {
  inspectFromBrowser,
  loadFromBrowser,
  type ClickHouseLoadResult,
} from "./clickhouse-browser";
import {
  DEFAULT_CONNECTION,
  publicProfile,
  type ClickHouseInfo,
  type ClickHouseProfile,
  type ClickHouseProgress,
} from "./clickhouse-http";

export function ClickHouseDialog({
  open,
  services,
  onClose,
  onBusy,
  onProgress,
  onLoaded,
}: {
  open: boolean;
  services: RuntimeServices;
  onClose: () => void;
  onBusy: (busy: boolean) => void;
  onProgress: (progress: ClickHouseProgress) => void;
  onLoaded: (result: ClickHouseLoadResult) => Promise<void>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const active = useRef<AbortController | null>(null);
  const edited = useRef(false);
  const dateEdited = useRef(false);
  const title = useId();
  const [connection, setConnection] = useState({ ...DEFAULT_CONNECTION });
  const [range, setRange] = useState({ start: "", end: "", strictPit: false, refresh: false });
  const [info, setInfo] = useState<ClickHouseInfo | null>(null);
  const [operation, setOperation] = useState<"inspect" | "load" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<ClickHouseProgress | null>(null);
  const [cancelled, setCancelled] = useState(false);
  useEffect(() => {
    let disposed = false;
    void services.metadata
      ?.get("jsg-clickhouse-profile-v1")
      .then((raw) => {
        if (disposed || raw === undefined || edited.current) return;
        const profile = JSON.parse(raw) as ClickHouseProfile;
        const safe = publicProfile({ ...profile, password: "" }, { ...profile, refresh: false });
        setConnection({ url: safe.url, database: safe.database, user: safe.user, password: "" });
        setRange({ start: safe.start, end: safe.end, strictPit: safe.strictPit, refresh: false });
        dateEdited.current = true;
      })
      .catch(() => undefined);
    return () => {
      disposed = true;
      active.current?.abort();
    };
  }, [services]);
  useEffect(() => {
    if (!open || dialog.current === null) return;
    const previous = document.activeElement;
    dialog.current.showModal();
    return () => {
      active.current?.abort();
      dialog.current?.close();
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, [open]);
  const updateConnection = (patch: Partial<typeof connection>) => {
    edited.current = true;
    setConnection((value) => ({ ...value, ...patch }));
    setInfo(null);
    setError(null);
    setCancelled(false);
  };
  const updateRange = (patch: Partial<typeof range>) => {
    setRange((value) => ({ ...value, ...patch }));
    setError(null);
    setCancelled(false);
  };
  const start = (kind: "inspect" | "load") => {
    if (active.current !== null) return null;
    const controller = new AbortController();
    active.current = controller;
    setOperation(kind);
    setError(null);
    setProgress(null);
    setCancelled(false);
    onBusy(true);
    return controller;
  };
  const finish = (controller: AbortController) => {
    if (active.current === controller) active.current = null;
    setOperation(null);
    onBusy(false);
  };
  const fail = (controller: AbortController, caught: unknown) => {
    if (controller.signal.aborted) setCancelled(true);
    else setError(caught instanceof Error ? caught.message : String(caught));
  };
  const inspect = async () => {
    const controller = start("inspect");
    if (controller === null) return;
    try {
      const result = await inspectFromBrowser(connection, controller.signal);
      setInfo(result);
      if (!dateEdited.current) {
        const beginning = `${result.lastBacktestDate.slice(0, 4)}-01-01`;
        setRange((value) => ({
          ...value,
          start: beginning > result.firstDate ? beginning : result.firstDate,
          end: result.lastBacktestDate,
        }));
      }
      if (!result.strictPitReady) setRange((value) => ({ ...value, strictPit: false }));
    } catch (caught) {
      fail(controller, caught);
    } finally {
      finish(controller);
    }
  };
  const load = async () => {
    const controller = start("load");
    if (controller === null) return;
    try {
      const profile = publicProfile(connection, range);
      await services.metadata?.set("jsg-clickhouse-profile-v1", JSON.stringify(profile));
      const result = await loadFromBrowser(connection, range, controller.signal, (value) => {
        setProgress(value);
        onProgress(value);
      });
      controller.signal.throwIfAborted();
      finish(controller);
      await onLoaded(result);
    } catch (caught) {
      fail(controller, caught);
      finish(controller);
    }
  };
  const dismiss = () => {
    if (operation !== null) active.current?.abort();
    else onClose();
  };
  return (
    <dialog
      ref={dialog}
      className="jsg-connection-dialog"
      aria-labelledby={title}
      onCancel={(event) => {
        event.preventDefault();
        dismiss();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget && operation === null) onClose();
      }}
    >
      <header className="jsg-connection-head">
        <div className="jsg-connection-icon">
          <Database size={22} />
        </div>
        <div>
          <span className="jsg-connection-eyebrow">CLICKHOUSE / DATA SOURCE</span>
          <h2 id={title}>连接研究数据</h2>
        </div>
        <button className="ui-btn ui-btn-ghost" aria-label="关闭数据连接" onClick={dismiss}>
          <X size={18} />
        </button>
      </header>
      <div className="jsg-connection-body">
        <fieldset disabled={operation !== null}>
          <label className="jsg-connection-field">
            服务器地址
            <input
              aria-label="ClickHouse 地址"
              type="url"
              value={connection.url}
              placeholder="http://localhost:8123/"
              autoFocus
              onChange={(e) => updateConnection({ url: e.currentTarget.value })}
            />
          </label>
          <div className="jsg-connection-grid">
            <label className="jsg-connection-field">
              数据库
              <input
                aria-label="ClickHouse 数据库"
                value={connection.database}
                onChange={(e) => updateConnection({ database: e.currentTarget.value })}
              />
            </label>
            <label className="jsg-connection-field">
              用户名
              <input
                aria-label="ClickHouse 用户名"
                autoComplete="username"
                value={connection.user}
                onChange={(e) => updateConnection({ user: e.currentTarget.value })}
              />
            </label>
          </div>
          <label className="jsg-connection-field">
            密码
            <input
              aria-label="ClickHouse 密码"
              type="password"
              autoComplete="off"
              value={connection.password}
              placeholder="未设置密码时留空"
              onChange={(e) => updateConnection({ password: e.currentTarget.value })}
            />
          </label>
        </fieldset>
        <div className="jsg-connection-test">
          <span className="jsg-connection-status" data-connected={info !== null}>
            {info !== null ? <Check size={14} /> : <span className="jsg-connection-dot" />}
            {info !== null ? `已连接 · ${info.version}` : "密码仅保留在当前会话"}
          </span>
          <button className="ui-btn" disabled={operation !== null} onClick={() => void inspect()}>
            {operation === "inspect" && <LoaderCircle size={14} className="jsg-spin" />}测试连接
          </button>
        </div>
        <div className="jsg-connection-range">
          <div className="jsg-section-title">
            <span>回测区间</span>
            <span>{info === null ? "连接后可查看数据范围" : `行情至 ${info.lastDate}`}</span>
          </div>
          <fieldset disabled={operation !== null} className="jsg-connection-grid">
            <label className="jsg-connection-field">
              开始日期
              <input
                type="date"
                aria-label="回测开始日期"
                value={range.start}
                max={range.end || undefined}
                onChange={(e) => {
                  dateEdited.current = true;
                  updateRange({ start: e.currentTarget.value });
                }}
              />
            </label>
            <label className="jsg-connection-field">
              结束日期
              <input
                type="date"
                aria-label="回测结束日期"
                value={range.end}
                min={range.start || undefined}
                max={info?.lastBacktestDate}
                onChange={(e) => {
                  dateEdited.current = true;
                  updateRange({ end: e.currentTarget.value });
                }}
              />
            </label>
          </fieldset>
          <div className="jsg-connection-options">
            <label>
              <input
                type="checkbox"
                disabled={operation !== null}
                checked={range.refresh}
                onChange={(e) => updateRange({ refresh: e.currentTarget.checked })}
              />
              <RefreshCw size={12} />
              重新获取数据
            </label>
            <label
              title={
                info?.strictPitReady
                  ? "按公告时间与实际公司行动获取历史数据"
                  : "源库需要完整历史表及已审核的覆盖记录"
              }
            >
              <input
                type="checkbox"
                disabled={operation !== null || !info?.strictPitReady}
                checked={range.strictPit}
                onChange={(e) => updateRange({ strictPit: e.currentTarget.checked })}
              />
              严格历史数据
            </label>
          </div>
          <p className="jsg-connection-note">自动补充 30 个预热交易日。已有本地快照可直接复用。</p>
          {info !== null && !info.strictPitReady && (
            <p className="jsg-connection-quality">
              当前库使用成分快照，历史成分与财报修订尚不完整。
            </p>
          )}
        </div>
        {error !== null && (
          <p role="alert" className="jsg-alert">
            {error}
          </p>
        )}
        {cancelled && (
          <p role="status" className="jsg-connection-note">
            数据加载已取消，当前研究数据保留。
          </p>
        )}
        {operation === "load" && (
          <div className="jsg-connection-progress" role="status" aria-live="polite">
            <span>{progress?.text ?? "准备连接…"}</span>
            <progress value={progress?.completed ?? 0} max={Math.max(1, progress?.total ?? 1)} />
            <small>
              {(progress?.rows ?? 0).toLocaleString()} 行 ·{" "}
              {((progress?.bytes ?? 0) / 1024 / 1024).toFixed(1)} MiB
            </small>
          </div>
        )}
      </div>
      <footer className="jsg-connection-foot">
        <span>数据保存在此浏览器，参数调整可重复回测。</span>
        {operation !== null ? (
          <button className="ui-btn" onClick={() => active.current?.abort()}>
            取消加载
          </button>
        ) : (
          <button
            className="ui-btn ui-btn-primary"
            disabled={!range.start || !range.end}
            onClick={() => void load()}
          >
            加载并回测
            <ArrowRight size={14} />
          </button>
        )}
      </footer>
    </dialog>
  );
}
