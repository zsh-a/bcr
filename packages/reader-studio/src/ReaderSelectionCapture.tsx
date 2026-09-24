import { useEffect, useRef, useState } from "react";
import { BookmarkPlus, X } from "lucide-react";
import { useResearchCapture, useRuntimeActivity, type ResearchCapture } from "@bcr/react";
import type { ReaderBook } from "@bcr/reader-core";
import type { ReaderRuntime } from "./runtime";
import { readerSelectionLocator } from "./readingPosition";
import { captureReaderSelection } from "./readerCapture";
import { ReaderSheet } from "./ReaderSheet";
import { persistReaderSnapshot } from "./readerPersistenceQueue";
import { getReaderState } from "./store";
import { decodeTextCitation } from "@bcr/core";

const PENDING_CAPTURE_KEY = "bcr-reader-pending-capture";

export function ReaderSelectionCapture(props: {
  workspaceCollections: boolean;
  book: ReaderBook;
  runtime: ReaderRuntime;
  onNotice: (message: string) => void;
}) {
  const service = useResearchCapture();
  const active = useRuntimeActivity();
  const [selection, setSelection] = useState<ResearchCapture | null>(null);
  const [selectionTooLong, setSelectionTooLong] = useState(false);
  const [capture, setCapture] = useState<ResearchCapture | null>(null);
  const [collectionId, setCollectionId] = useState("");
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const newId = useRef(crypto.randomUUID());
  useEffect(() => {
    if (!active || capture || (!service && !props.workspaceCollections)) return;
    const update = () => {
      const text = window.getSelection()?.toString() ?? "";
      const anchor = window.getSelection()?.anchorNode;
      const element = anchor instanceof Element ? anchor : anchor?.parentElement;
      const tooLong = text.length > 512 && !!element?.closest("[data-reader-section]");
      setSelectionTooLong(tooLong);
      if (tooLong) {
        setSelection(null);
        return;
      }
      const locator = readerSelectionLocator(props.book);
      try {
        setSelection(locator ? captureReaderSelection(props.book, locator) : null);
      } catch {
        setSelection(null);
      }
    };
    document.addEventListener("selectionchange", update);
    return () => document.removeEventListener("selectionchange", update);
  }, [service, active, capture, props.book, props.workspaceCollections]);
  useEffect(() => {
    setSelection(null);
    setCapture(null);
    setSelectionTooLong(false);
  }, [props.book.id, active]);
  useEffect(() => {
    if (!service || !active) return;
    try {
      const raw = sessionStorage.getItem(PENDING_CAPTURE_KEY);
      if (!raw) return;
      const pending = JSON.parse(raw);
      const citation = decodeTextCitation(pending.citation);
      const route = new URL(pending.document?.route, window.location.origin);
      if (
        !citation ||
        pending.document?.source !== "reader" ||
        pending.document?.kind !== "reader-section" ||
        typeof pending.document?.id !== "string" ||
        typeof pending.document?.title !== "string" ||
        (pending.document?.subtitle !== undefined &&
          typeof pending.document.subtitle !== "string") ||
        route.origin !== window.location.origin ||
        route.pathname !== "/reader" ||
        citation.source.scope !==
          JSON.stringify([
            "reader",
            route.searchParams.get("book"),
            route.searchParams.get("section"),
          ])
      ) {
        sessionStorage.removeItem(PENDING_CAPTURE_KEY);
        return;
      }
      if (route.searchParams.get("book") !== props.book.id) return;
      setCapture({ ...pending, citation, note: "" });
      setCollectionId(service.collections[0]?.id ?? "");
      sessionStorage.removeItem(PENDING_CAPTURE_KEY);
    } catch {
      try {
        sessionStorage.removeItem(PENDING_CAPTURE_KEY);
      } catch {
        /* Storage access can itself be unavailable. */
      }
    }
  }, [service, active, props.book.id]);
  if (!active || (!service && !props.workspaceCollections)) return null;
  const close = () => {
    if (!saving.current) {
      setCapture(null);
      setSelection(null);
    }
  };
  const save = async () => {
    if (!capture || !service || saving.current) return;
    saving.current = true;
    setBusy(true);
    setError(null);
    try {
      if (!getReaderState().library.some((book) => book.id === props.book.id))
        throw new Error("来源读物已移除，请重新打开后摘录。");
      await persistReaderSnapshot(props.runtime, { durableLibrary: true, strict: true });
      const result = await service.save(
        collectionId ? { id: collectionId } : { id: newId.current, name: name.trim() },
        { ...capture, note },
      );
      props.onNotice(
        result === "duplicate" ? "此选段已在集合中，已有笔记保留。" : "已加入资料集合",
      );
      setCapture(null);
      setSelection(null);
      window.getSelection()?.removeAllRanges();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      saving.current = false;
      setBusy(false);
    }
  };
  return (
    <>
      {selectionTooLong && !capture && (
        <span className="reader-selection-capture ui-btn ui-btn-lg ui-btn-default" role="status">
          选段过长，请选择不超过 512 个字符
        </span>
      )}
      {selection && !capture && (
        <button
          type="button"
          className="reader-selection-capture ui-btn ui-btn-lg ui-btn-primary"
          onPointerDown={(event) => event.preventDefault()}
          onClick={() => {
            if (!service) {
              if (saving.current) return;
              saving.current = true;
              void persistReaderSnapshot(props.runtime, { durableLibrary: true, strict: true })
                .then(() => {
                  sessionStorage.setItem(PENDING_CAPTURE_KEY, JSON.stringify(selection));
                  window.location.assign(`/reader?book=${encodeURIComponent(props.book.id)}`);
                })
                .catch((reason: unknown) => {
                  saving.current = false;
                  props.onNotice(`打开资料集合失败：${String(reason)}`);
                });
              return;
            }
            setCapture(selection);
            setCollectionId(service.collections[0]?.id ?? "");
            setNote("");
            setName("");
            setError(null);
            newId.current = crypto.randomUUID();
          }}
        >
          <BookmarkPlus className="reader-icon" />
          加入资料集合
        </button>
      )}
      <ReaderSheet
        open={Boolean(capture && service)}
        labelId="reader-capture-title"
        onClose={close}
      >
        {capture && service ? (
          <form
            className="reader-mobile-sheet reader-data-sheet reader-capture-sheet"
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
          >
            <div className="reader-annotation-composer-heading">
              <div>
                <span className="ui-section-label">COLLECT</span>
                <strong id="reader-capture-title">保存选段</strong>
              </div>
              <button
                type="button"
                className="ui-btn ui-icon-btn ui-btn-ghost ui-btn-lg"
                aria-label="关闭摘录"
                disabled={busy}
                onClick={close}
              >
                <X className="reader-icon" />
              </button>
            </div>
            <small>
              {capture.document.subtitle} · {capture.document.title}
            </small>
            <blockquote>{capture.citation.exact}</blockquote>
            <label>
              资料集合
              <select
                aria-label="摘录目标集合"
                value={collectionId}
                disabled={busy}
                onChange={(event) => setCollectionId(event.target.value)}
              >
                {service.collections.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
                <option value="">新建资料集合</option>
              </select>
            </label>
            {!collectionId && (
              <label>
                集合名称
                <input
                  autoFocus
                  maxLength={100}
                  value={name}
                  disabled={busy}
                  onChange={(event) => setName(event.target.value)}
                />
              </label>
            )}
            <label>
              摘录笔记
              <textarea
                aria-label="摘录笔记"
                maxLength={2000}
                placeholder="写下你的想法（可选）"
                value={note}
                disabled={busy}
                onChange={(event) => setNote(event.target.value)}
              />
            </label>
            {(error || service.error) && (
              <p className="reader-data-error" role="alert">
                {error ?? service.error}
              </p>
            )}
            <button
              type="submit"
              className="ui-btn ui-btn-lg ui-btn-primary"
              disabled={busy || !service.ready || (!collectionId && !name.trim())}
            >
              {busy ? "正在保存…" : "保存到集合"}
            </button>
          </form>
        ) : null}
      </ReaderSheet>
    </>
  );
}
