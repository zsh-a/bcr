import { useEffect, useRef, useState } from "react";
import { Archive, Download, Upload, X } from "lucide-react";
import { indexBook, type ReaderRuntime } from "../runtime";
import { ReaderSheet } from "../workbench/ReaderSheet";
import {
  backupNewBooks,
  createReaderBackup,
  inspectReaderBackup,
  prepareReaderRestore,
  planReaderBackup,
  readerBookMissingSource,
  readerBackupSnapshotBytes,
  preflightReaderBackup,
  type PreparedReaderBackup,
} from "./readerBackup";
import { getReaderState, reader } from "../state/store";
import { useReader } from "../state/useReader";
import { captureReaderProgress, persistReaderSnapshot } from "../workbench/useReaderRuntime";
import { formatBytes } from "../reading/readerPresentation";
import { planReaderRestoreRecords, type ReaderRestoreRecordSummary } from "./readerRestoreRecords";

function recordSummary(item: ReaderRestoreRecordSummary): string {
  return `${item.fresh ? "新增读物" : "保留本机读物"} · 导入 ${item.bookmarksAdded} 个书签、${item.annotationsAdded} 条笔记${item.progressAdded ? " · 补入进度" : ""}${item.progressKept ? " · 保留本机进度" : ""}${item.conflicts ? ` · ${item.conflicts} 条不同版本均保留` : ""}${item.skipped ? ` · ${item.skipped} 条记录无法对齐，不导入` : ""}`;
}

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
  const state = useReader((state) => state);
  const library = state.library;
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
  const restorePlan = prepared === null ? null : planReaderRestoreRecords(prepared.manifest, state);
  const mergedBooks =
    restorePlan?.entries.filter(
      (item) => !item.fresh && item.progressAdded + item.bookmarksAdded + item.annotationsAdded > 0,
    ).length ?? 0;
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
              新增 {fresh.length} 本 · 合并 {mergedBooks} 本 · 保留{" "}
              {prepared.manifest.books.length - fresh.length - mergedBooks} 本
            </h3>
            <p>
              {new Date(prepared.manifest.createdAt).toLocaleString()} 的备份。相同书籍按 ID
              或源文件校验值去重，保留本机进度并补入缺失进度。书签与笔记去重合并，同一记录的不同版本均保留；重复恢复不会重复添加。
            </p>
            <ul>
              {restorePlan?.entries.map((item) => (
                <li key={item.id}>
                  <span>{item.title}</span>
                  <small>{recordSummary(item)}</small>
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
              保留本机书名和收藏；新增或合并阅读记录。无法对齐的记录在上方明确列出，可选择一并恢复排版设置与阅读历史。
            </p>
            <button
              type="button"
              disabled={
                busy ||
                (fresh.length === 0 && !restorePlan?.added && !restoreSettings && !restoreHistory)
              }
              onClick={() =>
                void run(async (signal) => {
                  captureReaderProgress();
                  const books = await prepareReaderRestore(
                    props.runtime,
                    prepared,
                    getReaderState().library,
                    setMessage,
                    signal,
                  );
                  const snapshot = prepared.manifest;
                  const plan = planReaderRestoreRecords(snapshot, getReaderState(), books);
                  reader.mergeBackupRecords(books, plan.records);
                  if (restoreSettings) reader.setSettings(plan.settings);
                  if (restoreHistory)
                    reader.restoreReadingHistory(plan.navigationHistory, plan.searchSession);
                  await persistReaderSnapshot(props.runtime, {
                    durableLibrary: true,
                    strict: true,
                  });
                  for (const book of books) await indexBook(props.runtime, book);
                  setPrepared(null);
                  const merged = plan.entries.filter(
                    (item) =>
                      !item.fresh &&
                      item.progressAdded + item.bookmarksAdded + item.annotationsAdded > 0,
                  ).length;
                  const skipped = plan.entries.reduce((sum, item) => sum + item.skipped, 0);
                  const conflicts = plan.entries.reduce((sum, item) => sum + item.conflicts, 0);
                  setMessage(
                    `恢复完成，已新增 ${books.length} 本读物，合并 ${merged} 本已有读物，导入 ${plan.added} 条阅读记录；本机已有进度保留。${conflicts ? `${conflicts} 条不同版本均已保留。` : ""}${skipped ? `${skipped} 条记录无法对齐，未导入。` : ""}${restoreSettings && snapshot.settingsFallback ? "部分排版设置已回退默认值。" : ""}`,
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
