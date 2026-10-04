import { useEffect, useState } from "react";
import { protectLocalData, useAppOfflineState } from "./offlineState";
import "./app-offline.css";

const formatBytes = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;
export function AppOfflinePanel() {
  const offline = useAppOfflineState();
  const [online, setOnline] = useState(navigator.onLine);
  const [storage, setStorage] = useState<{
    persistent: boolean;
    usage?: number;
    quota?: number;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const refresh = async () => {
    try {
      const estimate = await navigator.storage?.estimate?.();
      const persistent = (await navigator.storage?.persisted?.()) ?? false;
      setStorage({ ...estimate, persistent });
    } catch {
      setMessage("暂时无法读取存储状态，已保存的内容不受影响。");
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
      <p>已保存到本机的内容可继续使用；在线同步和未下载的附件需要网络。</p>
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
        <strong>{storage?.persistent ? "已获得持久存储保护" : "本机数据使用浏览器存储"}</strong>
        {storage?.usage !== undefined && (
          <p>
            本站已用 {formatBytes(storage.usage)}
            {storage.quota ? ` / 约 ${formatBytes(storage.quota)}` : ""}
          </p>
        )}
        <p>Reader 与笔记共享本站存储空间。清除本站数据会影响两个应用，请定期导出备份。</p>
        {!storage?.persistent && (
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
                      ? "已保护本机数据，仍建议保留备份。"
                      : "浏览器暂未授予持久存储保护，请保留备份。",
                  );
                  await refresh();
                })
                .finally(() => setBusy(false));
            }}
          >
            {busy ? "正在申请…" : "保护离线数据"}
          </button>
        )}
      </div>
      {message && <p role="status">{message}</p>}
    </section>
  );
}
