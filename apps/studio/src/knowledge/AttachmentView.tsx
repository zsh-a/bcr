import { useEffect, useRef, useState } from "react";
import { Button, Dialog } from "@bcr/react";
import { Download, FileText, ImageOff, LoaderCircle } from "lucide-react";
import type { KnowledgeAttachments } from "./attachments";
import { ATTACHMENT_FILE_LIMIT, isPreviewImage, type KnowledgeAttachment } from "./attachmentModel";
import "./attachments.css";
import { AttachmentPdfPreview } from "./AttachmentPdfPreview";

export function attachmentSize(bytes: number) {
  return bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} KB`
    : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
function useAttachmentUrl(
  asset: KnowledgeAttachment | undefined,
  storage: KnowledgeAttachments,
  preview = false,
) {
  const [state, setState] = useState<{ url: string; error: string }>({ url: "", error: "" });
  useEffect(() => {
    let disposed = false,
      url = "";
    setState({ url: "", error: "" });
    if (!asset) {
      setState({ url: "", error: "附件记录缺失，请同步或恢复备份" });
      return;
    }
    void (preview ? storage.preview(asset) : storage.require(asset)).then(
      (blob) => {
        if (disposed) return;
        url = URL.createObjectURL(blob);
        setState({ url, error: "" });
      },
      (error) => {
        if (!disposed)
          setState({ url: "", error: error instanceof Error ? error.message : String(error) });
      },
    );
    return () => {
      disposed = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [asset, storage, preview]);
  return state;
}
function attachmentType(asset: KnowledgeAttachment) {
  if (isPreviewImage(asset.mime)) return "图片";
  if (asset.mime.startsWith("audio/")) return "音频";
  if (asset.mime.startsWith("video/")) return "视频";
  return /\.([a-z\d]{1,12})$/iu.exec(asset.name)?.[1]?.toUpperCase() ?? "文件";
}
export function downloadAttachment(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob),
    anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
export function AttachmentInline({
  asset,
  storage,
  label,
  image = false,
  onOpen,
  onMenu,
}: {
  asset: KnowledgeAttachment | undefined;
  storage: KnowledgeAttachments;
  label: string;
  image?: boolean;
  onOpen: () => void;
  onMenu?: ((x: number, y: number) => void) | undefined;
}) {
  const preview = image && !!asset && isPreviewImage(asset.mime);
  const gesture = useRef<{ timer: ReturnType<typeof setTimeout>; x: number; y: number } | null>(
    null,
  );
  const suppressClick = useRef(false);
  const cancel = () => {
    if (gesture.current) clearTimeout(gesture.current.timer);
    gesture.current = null;
  };
  useEffect(() => cancel, []);
  return (
    <span
      className={preview ? "knowledge-image-block" : "knowledge-attachment-inline"}
      onPointerDown={(event) => {
        cancel();
        suppressClick.current = false;
        if (event.pointerType !== "touch" || !onMenu) return;
        const { clientX: x, clientY: y } = event;
        gesture.current = {
          x,
          y,
          timer: setTimeout(() => {
            gesture.current = null;
            suppressClick.current = true;
            onMenu(x, y);
          }, 500),
        };
      }}
      onPointerMove={(event) => {
        if (
          gesture.current &&
          Math.hypot(event.clientX - gesture.current.x, event.clientY - gesture.current.y) > 8
        )
          cancel();
      }}
      onPointerUp={cancel}
      onPointerCancel={cancel}
      onClickCapture={(event) => {
        if (suppressClick.current) {
          suppressClick.current = false;
          event.preventDefault();
          event.stopPropagation();
        }
      }}
      onKeyDown={(event) => {
        if (!onMenu || !(event.key === "ContextMenu" || (event.key === "F10" && event.shiftKey)))
          return;
        event.preventDefault();
        const box = event.currentTarget.getBoundingClientRect();
        onMenu(box.left + 16, box.top + 16);
      }}
      onContextMenu={(event) => {
        if (!onMenu || event.shiftKey) return;
        event.preventDefault();
        event.stopPropagation();
        onMenu(event.clientX, event.clientY);
      }}
    >
      {preview ? (
        <InlineImage asset={asset!} storage={storage} label={label} onOpen={onOpen} />
      ) : (
        <button type="button" className="knowledge-file-link" onClick={onOpen}>
          <FileText size={18} aria-hidden="true" />
          <span>{label || asset?.name || "附件缺失"}</span>
          {asset && <small>{attachmentSize(asset.size)}</small>}
        </button>
      )}
    </span>
  );
}
function InlineImage({
  asset,
  storage,
  label,
  onOpen,
}: {
  asset: KnowledgeAttachment;
  storage: KnowledgeAttachments;
  label: string;
  onOpen: () => void;
}) {
  const { url, error } = useAttachmentUrl(asset, storage, true);
  const [failed, setFailed] = useState(false);
  const displayWidth =
    asset.width && asset.height
      ? Math.min(asset.width, (560 * asset.width) / asset.height)
      : undefined;
  if (error || failed)
    return (
      <button type="button" className="knowledge-attachment-missing" onClick={onOpen}>
        <ImageOff size={18} />
        {error || "图片无法预览，点击查看附件"}
      </button>
    );
  return (
    <button
      type="button"
      className="knowledge-image-preview"
      aria-label={`查看图片：${label || asset.name}`}
      onClick={onOpen}
      style={
        asset.width && asset.height
          ? {
              width: `${Math.max(32, displayWidth!)}px`,
              maxWidth: "100%",
              aspectRatio: `${asset.width} / ${asset.height}`,
            }
          : undefined
      }
    >
      {url ? (
        <img
          src={url}
          alt={label || asset.name}
          loading="lazy"
          decoding="async"
          onError={() => setFailed(true)}
        />
      ) : (
        <span className="knowledge-attachment-loading">
          <LoaderCircle size={18} />
          正在载入图片
        </span>
      )}
    </button>
  );
}

export function AttachmentDialog({
  asset,
  storage,
  onClose,
  onReadText,
  onReader,
  onNextText,
  text,
  ocrLanguage,
  onOcrLanguageChange,
}: {
  asset: KnowledgeAttachment;
  storage: KnowledgeAttachments;
  onClose: () => void;
  onReadText?: (() => void) | undefined;
  onReader?: (() => void) | undefined;
  onNextText?: (() => void) | undefined;
  text?: { body: string; status: string; busy: boolean; error: string } | undefined;
  ocrLanguage?: "en" | "ja";
  onOcrLanguageChange?: ((language: "en" | "ja") => void) | undefined;
}) {
  const { url, error } = useAttachmentUrl(asset, storage);
  const [downloadError, setDownloadError] = useState("");
  return (
    <Dialog open onClose={onClose} title={asset.name} className="knowledge-attachment-dialog">
      <div className="knowledge-attachment-dialog-meta">
        <span>
          {attachmentType(asset)} · {attachmentSize(asset.size)}
        </span>
        <div>
          {isPreviewImage(asset.mime) && onOcrLanguageChange && (
            <label className="knowledge-ocr-language">
              识别语言
              <select
                aria-label="图片文字语言"
                value={ocrLanguage}
                disabled={text?.busy}
                onChange={(event) => onOcrLanguageChange(event.target.value as "en" | "ja")}
              >
                <option value="en">英语</option>
                <option value="ja">日语</option>
              </select>
            </label>
          )}
          {onReader && (
            <Button variant="ghost" size="sm" onClick={onReader}>
              在 Reader 中打开
            </Button>
          )}
          {onReadText && (
            <Button variant="ghost" size="sm" disabled={text?.busy} onClick={onReadText}>
              {text?.busy ? "正在提取…" : isPreviewImage(asset.mime) ? "识别图片文字" : "提取文本"}
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            disabled={!url}
            onClick={() =>
              void storage
                .require(asset)
                .then((blob) => downloadAttachment(blob, asset.name))
                .catch((reason) =>
                  setDownloadError(reason instanceof Error ? reason.message : String(reason)),
                )
            }
          >
            <Download size={15} />
            下载
          </Button>
        </div>
      </div>
      {downloadError && (
        <p role="alert" className="knowledge-attachment-error">
          {downloadError}
        </p>
      )}
      {error ? (
        <p role="alert" className="knowledge-attachment-error">
          {error}
        </p>
      ) : !url ? (
        <p role="status">正在载入附件…</p>
      ) : (
        <div className="knowledge-attachment-viewer">
          {isPreviewImage(asset.mime) ? (
            <img src={url} alt={asset.name} />
          ) : asset.mime === "application/pdf" ? (
            <AttachmentPdfPreview asset={asset} storage={storage} />
          ) : asset.mime.startsWith("audio/") ? (
            <audio src={url} controls preload="metadata" />
          ) : asset.mime.startsWith("video/") ? (
            <video src={url} controls preload="metadata" />
          ) : (
            <div className="knowledge-file-placeholder">
              <FileText size={36} />
              <p>{asset.name}</p>
              <p>原文件已保存在本机，可下载后打开。</p>
            </div>
          )}
        </div>
      )}
      {text && (text.busy || text.error || text.body) && (
        <section className="knowledge-attachment-text" aria-label="附件提取文本">
          {text.busy && <p role="status">{text.status || "正在提取文本…"}</p>}
          {text.error && <p role="alert">{text.error}</p>}
          {text.body && <pre>{text.body}</pre>}
          {text.body && <p className="knowledge-small">{text.status}</p>}
          {onNextText && (
            <Button variant="ghost" size="sm" disabled={text.busy} onClick={onNextText}>
              继续读取
            </Button>
          )}
        </section>
      )}
    </Dialog>
  );
}

export function RemoteImage({
  src,
  alt,
  onSave,
}: {
  src: string;
  alt: string;
  onSave?: ((file: File) => Promise<void>) | undefined;
}) {
  const [loaded, setLoaded] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const valid = /^https?:\/\//iu.test(src);
  async function save() {
    if (!valid || !onSave || busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(src, {
        credentials: "omit",
        signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok) throw new Error("外部图片下载失败");
      if (Number(response.headers.get("content-length")) > ATTACHMENT_FILE_LIMIT)
        throw new Error("外部图片超过容量限制");
      if (!response.body) throw new Error("外部图片响应为空");
      let size = 0;
      const bounded = response.body.pipeThrough(
        new TransformStream<Uint8Array, Uint8Array>({
          transform(chunk, output) {
            size += chunk.length;
            if (size > ATTACHMENT_FILE_LIMIT) throw new Error("外部图片超过容量限制");
            output.enqueue(chunk);
          },
        }),
      );
      const blob = await new Response(bounded, {
        headers: {
          "Content-Type": response.headers.get("content-type") ?? "application/octet-stream",
        },
      }).blob();
      const name = decodeURIComponent(new URL(src).pathname.split("/").at(-1) || "外部图片.png");
      await onSave(new File([blob], name, { type: blob.type }));
    } catch {
      setError("无法保存外部图片。可下载后拖入笔记。");
    } finally {
      setBusy(false);
    }
  }
  return (
    <span className="knowledge-image-block knowledge-remote-image">
      {loaded && valid ? (
        <img
          src={src}
          alt={alt}
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setError("外部图片无法加载")}
        />
      ) : (
        <span>{alt}</span>
      )}
      <span className="knowledge-remote-image-actions">
        {!loaded && valid && (
          <Button variant="ghost" size="sm" onClick={() => setLoaded(true)}>
            加载外部图片
          </Button>
        )}
        {valid && onSave && (
          <Button variant="ghost" size="sm" disabled={busy} onClick={() => void save()}>
            {busy ? "正在保存…" : "保存到本机"}
          </Button>
        )}
      </span>
      {error && <span role="alert">{error}</span>}
    </span>
  );
}
