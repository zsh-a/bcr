import { useEffect, useRef, useState } from "react";
import { Archive, Download, Upload, X } from "lucide-react";
import { indexBook, type ReaderRuntime } from "./runtime";
import { ReaderSheet } from "./ReaderSheet";
import {
  backupNewBooks,
  createReaderBackup,
  inspectReaderBackup,
  prepareReaderRestore,
  type PreparedReaderBackup,
} from "./readerBackup";
import { getReaderState, reader, useReader } from "./store";
import { captureReaderProgress, persistReaderSnapshot } from "./useReaderRuntime";
import { formatBytes } from "./readerPresentation";

export function ReaderBackupPanel(props: { runtime: ReaderRuntime; onClose: () => void }) {
  const library = useReader((state) => state.library);
  const saveError = useReader((state) => state.saveError);
  const [prepared, setPrepared] = useState<PreparedReaderBackup | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [restoreSettings, setRestoreSettings] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [download, setDownload] = useState<{ url: string; name: string } | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  useEffect(
    () => () => {
      if (download !== null) URL.revokeObjectURL(download.url);
    },
    [download],
  );
  const run = async (action: (signal: AbortSignal) => Promise<void>) => {
    if (controller.current !== null) return;
    const task = new AbortController();
    controller.current = task;
    setBusy(true);
    setError("");
    try {
      await action(task.signal);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      setMessage("");
    } finally {
      controller.current = null;
      setBusy(false);
    }
  };
  const fresh = prepared === null ? [] : backupNewBooks(prepared, library);
  return (
    <ReaderSheet
      labelId="reader-backup-title"
      onClose={() => {
        if (!busy) props.onClose();
      }}
    >
      <section className="reader-mobile-sheet reader-data-sheet">
        <header className="reader-data-heading">
          <div>
            <span className="reader-eyebrow">YOUR READING, KEPT SAFE</span>
            <h2 id="reader-backup-title">备份与恢复</h2>
          </div>
          <button
            type="button"
            className="reader-icon-button"
            disabled={busy}
            aria-label="关闭备份与恢复"
            onClick={props.onClose}
          >
            <X className="reader-icon" />
          </button>
        </header>
        <p>
          书籍原文件、进度、书签、笔记与排版设置，一起保存在你的 ZIP
          文件中。全程在本机处理，不上传。
        </p>
        <div className="reader-data-card">
          <Archive className="reader-icon" />
          <div>
            <strong>{library.length} 本读物</strong>
            <p>浏览器存储不等于备份。请把导出的文件保存到安全的位置。</p>
          </div>
        </div>
        <div className="reader-data-actions">
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              void run(async (signal) => {
                captureReaderProgress();
                const blob = await createReaderBackup(
                  props.runtime,
                  getReaderState(),
                  setMessage,
                  signal,
                );
                setDownload({
                  url: URL.createObjectURL(blob),
                  name: `reader-backup-${new Date().toISOString().slice(0, 10)}.zip`,
                });
                setMessage(`备份已生成 · ${formatBytes(blob.size)}。请点击下载并保管文件。`);
              })
            }
          >
            <Download className="reader-icon" />
            生成完整备份
          </button>
          <button type="button" disabled={busy} onClick={() => fileInput.current?.click()}>
            <Upload className="reader-icon" />
            选择备份恢复
          </button>
        </div>
        {download !== null && (
          <a className="reader-data-download" href={download.url} download={download.name}>
            下载 {download.name}
          </a>
        )}
        <input
          ref={fileInput}
          className="reader-visually-hidden"
          type="file"
          accept=".zip,application/zip"
          aria-label="选择 Reader 备份"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file === undefined) return;
            setPrepared(null);
            void run(async (signal) => {
              setMessage("正在检查备份…");
              setPrepared(await inspectReaderBackup(file, setMessage, signal));
              setMessage("文件完整性检查通过，请确认恢复内容。");
            });
          }}
        />
        {prepared !== null && (
          <section className="reader-backup-preview" aria-label="恢复预览">
            <span className="reader-eyebrow">RESTORE PREVIEW</span>
            <h3>
              新增 {fresh.length} 本 · 跳过 {prepared.manifest.books.length - fresh.length} 本
            </h3>
            <p>
              {new Date(prepared.manifest.createdAt).toLocaleString()} 的备份。相同书籍按 ID
              或源文件校验值去重，保留本机已有进度与笔记。
            </p>
            <ul>
              {prepared.manifest.books.map(({ book }) => (
                <li key={book.id}>
                  <span>{book.title}</span>
                  <small>
                    {fresh.some((entry) => entry.book.id === book.id) ? "新增" : "保留本机"}
                  </small>
                </li>
              ))}
            </ul>
            <label className="reader-data-option">
              <input
                type="checkbox"
                checked={restoreSettings}
                disabled={busy}
                onChange={(event) => setRestoreSettings(event.target.checked)}
              />
              同时使用备份中的排版设置
            </label>
            <button
              type="button"
              disabled={busy || (fresh.length === 0 && !restoreSettings)}
              onClick={() =>
                void run(async (signal) => {
                  const books = await prepareReaderRestore(
                    props.runtime,
                    prepared,
                    getReaderState().library,
                    setMessage,
                    signal,
                  );
                  const snapshot = prepared.manifest;
                  const ids = new Set(books.map((book) => book.id));
                  reader.reconcileLibrary(
                    books,
                    Object.fromEntries(
                      Object.entries(snapshot.progressByBook).filter(([id]) => ids.has(id)),
                    ),
                    Object.fromEntries(
                      Object.entries(snapshot.bookmarksByBook).filter(([id]) => ids.has(id)),
                    ),
                    getReaderState().activeBookId,
                    Object.fromEntries(
                      Object.entries(snapshot.annotationsByBook).filter(([id]) => ids.has(id)),
                    ),
                  );
                  if (restoreSettings) reader.setSettings(snapshot.settings);
                  await persistReaderSnapshot(props.runtime, {
                    durableLibrary: true,
                    strict: true,
                  });
                  for (const book of books) await indexBook(props.runtime, book);
                  setPrepared(null);
                  setMessage(`恢复完成，已新增 ${books.length} 本读物。现有书籍未被覆盖。`);
                })
              }
            >
              确认合并恢复
            </button>
          </section>
        )}
        <p role="status" aria-live="polite">
          {message}
        </p>
        {error && (
          <p className="reader-data-error" role="alert">
            {error}。可重新选择文件或重试；现有书籍不会被删除。
          </p>
        )}
        {saveError && (
          <div role="alert">
            <p>本次变更尚未保存到本机：{saveError}。请释放存储空间并重试，不要关闭页面。</p>
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await persistReaderSnapshot(props.runtime, {
                    durableLibrary: true,
                    strict: true,
                  });
                  setPrepared(null);
                  setMessage("书库与阅读记录已重新保存。");
                })
              }
            >
              重试保存
            </button>
          </div>
        )}
        {busy && (
          <button type="button" onClick={() => controller.current?.abort()}>
            取消操作
          </button>
        )}
        <small>单次备份最多包含 512 MiB 源文件。备份不加密，请妥善保管。</small>
      </section>
    </ReaderSheet>
  );
}
