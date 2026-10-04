import { useEffect, useState } from "react";
import { protectLocalData, useAppOfflineState } from "./offlineState";
import "./app-offline.css";

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  const units = ["KB", "MB", "GB", "TB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)) - 1, units.length - 1);
  return `${(bytes / 1024 ** (index + 1)).toFixed(1)} ${units[index]}`;
}

export function AppOfflinePanel({
  backup,
}: {
  backup?: { label: string; run: () => void | Promise<void>; successMessage?: string } | undefined;
} = {}) {
  const offline = useAppOfflineState();
  const [online, setOnline] = useState(navigator.onLine);
  const [storage, setStorage] = useState<{
    persistent: boolean;
    usage?: number;
    quota?: number;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [backupBusy, setBackupBusy] = useState(false);
  const [backupMessage, setBackupMessage] = useState("");
  const [backupError, setBackupError] = useState("");
  const [storageError, setStorageError] = useState(false);
  const [message, setMessage] = useState("");
  const refresh = async () => {
    try {
      const estimate = await navigator.storage?.estimate?.();
      const persistent = (await navigator.storage?.persisted?.()) ?? false;
      setStorage({ ...estimate, persistent });
      setStorageError(false);
    } catch {
      setStorageError(true);
    }
  };
  useEffect(() => {
    void refresh();
    const changed = () => setOnline(navigator.onLine);
    window.addEventListener("online", changed);
    window.addEventListener("offline", changed);
    return () => {
      window.removeEventListener("online", changed);
      window.removeEventListener("offline", changed);
    };
  }, []);
  const label =
    offline.phase === "ready"
      ? "应用已可离线打开"
      : offline.phase === "preparing"
        ? "正在准备离线应用…"
        : offline.phase === "error"
          ? "离线准备未完成"
          : "请打开独立应用以准备离线使用";
  return (
    <section className="bcr-offline-panel" aria-label="离线与存储">
      <div className="bcr-offline-heading">
        <strong>离线与存储</strong>
        <span>{online ? "已联网" : "当前离线"}</span>
      </div>
      <p role="status" data-offline-state={offline.phase}>
        {label}
      </p>
      <p>本机内容可离线使用；同步和未下载的附件需要联网。</p>
      {offline.phase === "error" && (
        <>
          <p role="alert">{offline.message}</p>
          <button
            type="button"
            className="ui-btn ui-btn-default"
            disabled={!online}
            onClick={() => window.dispatchEvent(new Event("bcr-retry-offline"))}
          >
            重试离线准备
          </button>
        </>
      )}
      <div className="bcr-offline-storage">
        <div className="bcr-offline-heading">
          <strong>本机存储</strong>
          {storage?.persistent && <span>已获保护</span>}
        </div>
        {!storage && !storageError && <p role="status">正在读取空间占用…</p>}
        {storage?.usage !== undefined && (
          <div className="bcr-offline-usage">
            <p>
              本站已用 <strong>{formatBytes(storage.usage)}</strong>
            </p>
            {storage.quota !== undefined && storage.quota > 0 && (
              <>
                <meter
                  min={0}
                  max={storage.quota}
                  value={Math.min(storage.usage, storage.quota)}
                  aria-label="本站存储占用"
                  aria-valuetext={`已用 ${formatBytes(storage.usage)}，浏览器额度约 ${formatBytes(storage.quota)}`}
                />
                <p>浏览器额度约 {formatBytes(storage.quota)}，会随设备空间变化。</p>
              </>
            )}
          </div>
        )}
        {storageError && <p>暂时无法读取空间占用，可重新打开此面板查看。</p>}
        <p>Reader 与笔记共享空间。清除本站数据会删除本机内容，请保留备份。</p>
        <div className="bcr-offline-actions">
          {backup && (
            <button
              type="button"
              className="ui-btn ui-btn-default"
              disabled={backupBusy}
              onClick={async () => {
                setBackupMessage("");
                setBackupError("");
                try {
                  const pending = backup.run();
                  if (pending) {
                    setBackupBusy(true);
                    await pending;
                  }
                  setBackupMessage(backup.successMessage ?? "");
                } catch (reason) {
                  setBackupError(
                    `备份未能完成：${reason instanceof Error ? reason.message : String(reason)}。请重试。`,
                  );
                } finally {
                  setBackupBusy(false);
                }
              }}
            >
              {backupBusy ? "正在准备备份…" : backup.label}
            </button>
          )}
          {!storage?.persistent && typeof navigator.storage?.persist === "function" && (
            <button
              type="button"
              className="ui-btn ui-btn-default"
              disabled={busy}
              onClick={() => {
                setBusy(true);
                void protectLocalData(true)
                  .then(async (granted) => {
                    setMessage(
                      granted
                        ? "已获保护，可减少空间不足时被自动清理的风险。备份仍需单独保存。"
                        : "浏览器暂未授予保护。内容仍保存在本机，建议导出备份。",
                    );
                    await refresh();
                  })
                  .finally(() => setBusy(false));
              }}
            >
              {busy ? "正在申请…" : "申请存储保护"}
            </button>
          )}
        </div>
      </div>
      {backupMessage && <p role="status">{backupMessage}</p>}
      {backupError && <p role="alert">{backupError}</p>}
      {message && <p role="status">{message}</p>}
    </section>
  );
}
