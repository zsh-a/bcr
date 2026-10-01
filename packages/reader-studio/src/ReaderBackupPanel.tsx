import { useEffect, useRef, useState } from "react";
import { Archive, Download, Upload, X } from "lucide-react";
import { indexBook, type ReaderRuntime } from "./runtime";
import { ReaderSheet } from "./ReaderSheet";
import {
  backupNewBooks,
  backupSkippedBooks,
  createReaderBackup,
  inspectReaderBackup,
  prepareReaderRestore,
  planReaderBackup,
  readerBookMissingSource,
  readerBackupSnapshotBytes,
  preflightReaderBackup,
  type PreparedReaderBackup,
} from "./readerBackup";
import { getReaderState, reader, useReader } from "./store";
import { captureReaderProgress, persistReaderSnapshot } from "./useReaderRuntime";
import { formatBytes } from "./readerPresentation";

type BackupErrorPhase = "export" | "restore" | "save";
const ERROR_HINTS: Record<BackupErrorPhase, string> = {
  export: "请调整备份选择后重试；现有书籍不会被删除。",
  restore: "可重新选择备份文件或重试；现有书籍不会被删除。",
  save: "请释放存储空间并重试，不要关闭页面。",
};

export function ReaderBackupPanel(props: {
  open: boolean;
  runtime: ReaderRuntime;
  onClose: () => void;
}) {
  const library = useReader((state) => state.library);
  const saveError = useReader((state) => state.saveError);
  const [prepared, setPrepared] = useState<PreparedReaderBackup | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [errorPhase, setErrorPhase] = useState<BackupErrorPhase>("export");
  const [sourceCheck, setSourceCheck] = useState<string[]>([]);
  const [checking, setChecking] = useState(true);
  const [restoreSettings, setRestoreSettings] = useState(false);
  const [restoreHistory, setRestoreHistory] = useState(false);
  const [selected, setSelected] = useState(() => new Set(library.map((book) => book.id)));
  const [volume, setVolume] = useState(0);
  const chosen = library.filter((book) => selected.has(book.id));
  let planningError = "";
  let volumes: (typeof library)[] = [];
  try {
    volumes = planReaderBackup(chosen, undefined, {
      snapshotSize: (book) =>
        readerBackupSnapshotBytes({ ...getReaderState(), library: [book] }, [book]),
      snapshotLimit: 64 * 1024 * 1024,
    });
  } catch (reason) {
    planningError = reason instanceof Error ? reason.message : String(reason);
  }
  const activeVolume = Math.min(volume, Math.max(0, volumes.length - 1));
  const controller = useRef<AbortController | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [download, setDownload] = useState<{ url: string; name: string } | null>(null);
  useEffect(() => {
    if (!props.open) return;
    let cancelled = false;
    setChecking(true);
    void preflightReaderBackup(props.runtime, chosen)
      .then((missing) => {
        if (!cancelled) {
          setSourceCheck(missing);
          setChecking(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setSourceCheck(["源文件检查失败，请重试打开备份面板"]);
          setChecking(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [props.open, props.runtime, library, selected]);
  useEffect(() => () => controller.current?.abort(), []);
  useEffect(
    () => () => {
      if (download !== null) URL.revokeObjectURL(download.url);
    },
    [download],
  );
  const run = async (
    action: (signal: AbortSignal) => Promise<void>,
    phase: BackupErrorPhase = "restore",
  ) => {
    if (controller.current !== null) return;
    const task = new AbortController();
    controller.current = task;
    setBusy(true);
    setError("");
    setErrorPhase(phase);
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
  const skipped = prepared === null ? [] : backupSkippedBooks(prepared.manifest, library);
  const skippedRecords = skipped.reduce(
    (sum, item) => sum + item.bookmarks + item.annotations + Number(item.progress),
    0,
  );
  return (
    <ReaderSheet
      open={props.open}
      labelId="reader-backup-title"
      onClose={() => {
        if (!busy) props.onClose();
      }}
    >
      <section className="reader-mobile-sheet reader-data-sheet">
        <header className="reader-data-heading">
          <div>
            <span className="ui-section-label">YOUR READING, KEPT SAFE</span>
            <h2 id="reader-backup-title">备份与恢复</h2>
          </div>
          <button
            type="button"
            className="ui-btn ui-icon-btn ui-btn-ghost ui-btn-lg"
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
          <details>
            <summary>
              选择备份内容 · {chosen.length} 本 · 约{" "}
              {formatBytes(
                chosen.reduce((sum, book) => sum + (book.source.ref?.size ?? book.source.size), 0),
              )}
            </summary>
            {library.map((book) => (
              <label className="reader-data-option" key={book.id}>
                <input
                  type="checkbox"
                  checked={selected.has(book.id)}
                  disabled={busy}
                  onChange={(event) => {
                    const next = new Set(selected);
                    if (event.target.checked) next.add(book.id);
                    else next.delete(book.id);
                    setSelected(next);
                    setVolume(0);
                  }}
                />
                {book.title}
                {readerBookMissingSource(book) && <small> · 缺少源文件</small>}
              </label>
            ))}
          </details>
          {volumes.length > 1 && (
            <label>
              独立备份卷
              <select
                aria-label="选择备份卷"
                value={activeVolume}
                disabled={busy}
                onChange={(event) => setVolume(Number(event.target.value))}
              >
                {volumes.map((books, index) => (
                  <option key={index} value={index}>
                    第 {index + 1}/{volumes.length} 卷 · {books.length} 本
                  </option>
                ))}
              </select>
              <small>逐卷生成并下载，每一卷均可独立恢复。</small>
            </label>
          )}
          {planningError && <p role="alert">{planningError}</p>}
          {checking && <p role="status">正在检查源文件…</p>}
          {sourceCheck.length > 0 && (
            <div role="alert">
              <strong>以下源文件需要重新导入，或从本次备份中取消选择：</strong>
              <ul>
                {sourceCheck.map((title) => (
                  <li key={title}>{title}</li>
                ))}
              </ul>
            </div>
          )}
          <button
            type="button"
            disabled={
              busy ||
              checking ||
              sourceCheck.length > 0 ||
              chosen.length === 0 ||
              planningError !== ""
            }
            onClick={() =>
              void run(async (signal) => {
                captureReaderProgress();
                const blob = await createReaderBackup(
                  props.runtime,
                  { ...getReaderState(), library: volumes[activeVolume] ?? chosen },
                  setMessage,
                  signal,
                );
                setDownload({
                  url: URL.createObjectURL(blob),
                  name: `reader-backup-${new Date().toISOString().slice(0, 10)}-part-${activeVolume + 1}.zip`,
                });
                setMessage(`备份已生成 · ${formatBytes(blob.size)}。请点击下载并保管文件。`);
              }, "export")
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
          className="ui-sr-only"
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
            <span className="ui-section-label">RESTORE PREVIEW</span>
            <h3>
              新增 {fresh.length} 本 · 跳过 {prepared.manifest.books.length - fresh.length} 本
            </h3>
            <p>
              {new Date(prepared.manifest.createdAt).toLocaleString()} 的备份。相同书籍按 ID
              或源文件校验值去重，保留本机已有进度与笔记。
              {skippedRecords > 0 &&
                `跳过读物在备份中的 ${skippedRecords} 条阅读记录（进度、书签、笔记）不会合并到本机。`}
            </p>
            <ul>
              {prepared.manifest.books.map(({ book }) => (
                <li key={book.id}>
                  <span>{book.title}</span>
                  <small>
                    {fresh.some((entry) => entry.book.id === book.id)
                      ? "新增"
                      : (() => {
                          const item = skipped.find((entry) => entry.id === book.id);
                          return `保留本机 · ${item?.matchedBy === "source" ? "同源文件" : item?.matchedBy === "duplicate" ? "备份内重复" : "相同 ID"} · 跳过${item?.progress ? "进度、" : ""}${item?.bookmarks ?? 0} 个书签、${item?.annotations ?? 0} 条笔记`;
                        })()}
                  </small>
                </li>
              ))}
            </ul>
            {prepared.manifest.settingsFallback && (
              <p role="status">
                备份包含当前版本不支持的排版值，已回退到默认设置；书籍与阅读记录仍可恢复。
              </p>
            )}
            <label className="reader-data-option">
              <input
                type="checkbox"
                checked={restoreSettings}
                disabled={busy}
                onChange={(event) => setRestoreSettings(event.target.checked)}
              />
              同时使用备份中的排版设置
            </label>
            <label className="reader-data-option">
              <input
                type="checkbox"
                checked={restoreHistory}
                disabled={busy}
                onChange={(event) => setRestoreHistory(event.target.checked)}
              />
              使用备份中的搜索与跳转历史（替换本机历史）
            </label>
            <p className="reader-data-summary">
              现有书籍不会被覆盖；可选择是否一并恢复排版设置与阅读历史。
            </p>
            <button
              type="button"
              disabled={busy || (fresh.length === 0 && !restoreSettings && !restoreHistory)}
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
                  if (restoreHistory)
                    reader.restoreReadingHistory(
                      snapshot.navigationHistory ?? { back: [], forward: [] },
                      snapshot.searchSession,
                    );
                  await persistReaderSnapshot(props.runtime, {
                    durableLibrary: true,
                    strict: true,
                  });
                  for (const book of books) await indexBook(props.runtime, book);
                  setPrepared(null);
                  setMessage(
                    `恢复完成，已新增 ${books.length} 本读物；跳过 ${skipped.length} 本已有读物及其 ${skippedRecords} 条备份阅读记录。${restoreSettings && snapshot.settingsFallback ? "部分排版设置已回退默认值。" : ""}`,
                  );
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
            {error}。{ERROR_HINTS[errorPhase]}
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
                }, "save")
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
