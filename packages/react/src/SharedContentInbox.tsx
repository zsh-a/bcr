import { useEffect, useRef, useState } from "react";
import { Dialog } from "./ui";
import { useUpdateParticipant } from "./AppUpdate";
import {
  listSharedContent,
  removeSharedContent,
  type ShareApp,
  type SharedContent,
} from "./shareInbox";
import { protectLocalData } from "./offlineState";
import "./share-inbox.css";

export function SharedContentInbox({
  app,
  ready,
  onAccept,
  onCancel,
}: {
  app: ShareApp;
  ready: boolean;
  onAccept: (content: SharedContent) => Promise<void>;
  onCancel?: () => void;
}) {
  const [items, setItems] = useState<SharedContent[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const processing = useRef(false);
  const [error, setError] = useState("");
  const clearQuery = () => {
    const url = new URL(location.href);
    url.searchParams.delete("share");
    url.searchParams.delete("shareError");
    history.replaceState(history.state, "", url);
  };
  useUpdateParticipant({
    blocked: () => (processing.current ? "分享内容正在保存，请完成后再更新。" : null),
    save: async () => {},
  });
  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams(location.search);
    void listSharedContent(app)
      .then((entries) => {
        if (cancelled) return;
        const id = params.get("share");
        if (id) entries.sort((a, b) => Number(b.id === id) - Number(a.id === id));
        setItems(entries);
        const failure =
          params.get("shareError") ||
          (id && !entries.some((entry) => entry.id === id)
            ? "这份分享已处理或已过期，请从来源应用重新分享。"
            : "");
        setError(failure);
        setOpen(entries.length > 0 || !!failure);
      })
      .catch(() => {
        if (!cancelled && (params.has("share") || params.has("shareError"))) {
          setError("无法读取分享收件箱，请保留当前页面并重新打开应用。");
          setOpen(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [app]);
  const item = items[0];
  const discard = async () => {
    if (processing.current) return;
    processing.current = true;
    setBusy(true);
    try {
      if (item) await removeSharedContent(app, item.id);
      clearQuery();
      setError("");
      setItems((current) => current.slice(1));
      setOpen(items.length > 1);
    } catch {
      setError("未能移除分享内容，请重试。");
    } finally {
      processing.current = false;
      setBusy(false);
    }
  };
  const accept = async () => {
    if (!item || !ready || processing.current) return;
    processing.current = true;
    setBusy(true);
    setError("");
    try {
      // Acknowledge only after the application has durably saved its content.
      await onAccept(item);
      await removeSharedContent(app, item.id);
      void protectLocalData();
      clearQuery();
      setItems((current) => current.slice(1));
      setOpen(items.length > 1);
    } catch (reason) {
      setError(
        `${reason instanceof Error ? reason.message : String(reason)}。分享内容已保留，可重试。`,
      );
    } finally {
      processing.current = false;
      setBusy(false);
    }
  };
  return (
    <>
      {!open && items.length > 0 && (
        <button
          type="button"
          className="ui-btn ui-btn-default bcr-share-pending"
          onClick={() => setOpen(true)}
        >
          待接收的分享 · {items.length}
        </button>
      )}
      <Dialog
        open={open}
        onClose={() => {
          if (!busy) setOpen(false);
        }}
        closable={!busy}
        title={app === "reader" ? "接收到阅读文件" : "接收到分享内容"}
        placement="sheet"
        className="bcr-share-dialog"
      >
        {item && (
          <>
            {item.files.length > 0 ? (
              <ul>
                {item.files.map((file, index) => (
                  <li key={index}>
                    {file.name}
                    <small>{(file.size / 1024 / 1024).toFixed(1)} MB</small>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="bcr-share-preview">
                <strong>{item.title || "分享的文字与链接"}</strong>
                <p>{item.text.slice(0, 1500)}</p>
                <p>{item.url}</p>
              </div>
            )}
            <p className="bcr-share-hint">
              内容已暂存本机，保留 7 天。
              {items.length > 1 ? `还有 ${items.length - 1} 份待处理。` : ""}
            </p>
          </>
        )}
        {error && <p role="alert">{error}</p>}
        <div className="bcr-share-actions">
          {busy && onCancel && (
            <button type="button" className="ui-btn ui-btn-default" onClick={onCancel}>
              取消导入
            </button>
          )}
          <button
            type="button"
            className="ui-btn ui-btn-default"
            disabled={busy}
            onClick={() => void discard()}
          >
            {item ? "移除这份分享" : "关闭"}
          </button>
          {item && (
            <button
              type="button"
              className="ui-btn ui-btn-primary"
              disabled={!ready || busy}
              onClick={() => void accept()}
            >
              {busy
                ? "正在保存…"
                : !ready
                  ? "正在打开应用…"
                  : app === "reader"
                    ? "导入书库"
                    : "保存为笔记"}
            </button>
          )}
        </div>
      </Dialog>
    </>
  );
}
