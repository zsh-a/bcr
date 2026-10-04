import { useEffect, useRef, useState } from "react";
import { BookmarkPlus, MessageSquarePlus, X } from "lucide-react";
import { useResearchCapture, useRuntimeActivity, type ResearchCapture } from "@bcr/react";
import type { ReaderBook, ReaderLocator } from "@bcr/reader-core";
import type { ReaderRuntime } from "../runtime";
import { loadReaderSelection } from "./readingPosition";
import { captureReaderSelection } from "../navigation/readerCapture";
import { ReaderSheet } from "../workbench/ReaderSheet";
import { persistReaderSnapshot } from "../persistence/readerPersistenceQueue";
import { getReaderState } from "../state/store";
import { decodeTextCitation } from "@bcr/core";

const PENDING_CAPTURE_KEY = "bcr-reader-pending-capture";

export function ReaderSelectionCapture(props: {
  workspaceCollections: boolean;
  onAddAnnotation: (locator: ReaderLocator) => void;
  book: ReaderBook;
  runtime: ReaderRuntime;
  onNotice: (message: string) => void;
}) {
  const service = useResearchCapture();
  const active = useRuntimeActivity();
  const [noteLocator, setNoteLocator] = useState<ReaderLocator | null>(null);
  const [selection, setSelection] = useState<ResearchCapture | null>(null);
  const [selectionError, setSelectionError] = useState<string | null>(null);
  const [capture, setCapture] = useState<ResearchCapture | null>(null);
  const [collectionId, setCollectionId] = useState("");
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const newId = useRef(crypto.randomUUID());
  useEffect(() => {
    if (!active || capture) return;
    let sequence = 0;
    const update = () => {
      const request = ++sequence;
      setSelection(null);
      setNoteLocator(null);
      setSelectionError(null);
      void loadReaderSelection(props.book, (locator) => ({
        capture:
          service || props.workspaceCollections
            ? captureReaderSelection(props.book, locator)
            : null,
        locator,
      })).then((result) => {
        if (request !== sequence) return;
        setSelection(result.value?.capture ?? null);
        setNoteLocator(result.value?.locator ?? null);
        setSelectionError(result.error ?? null);
      });
    };
    document.addEventListener("selectionchange", update);
    return () => {
      sequence++;
      document.removeEventListener("selectionchange", update);
    };
  }, [service, active, capture, props.book, props.workspaceCollections]);
  useEffect(() => {
    setSelection(null);
    setNoteLocator(null);
    setCapture(null);
    setSelectionError(null);
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
        props.onNotice("待保存的摘录已失效，请回到正文重新选择。");
        return;
      }
      if (route.searchParams.get("book") !== props.book.id) return;
      setCapture({ ...pending, citation, note: "" });
      setCollectionId(service.collections[0]?.id ?? "");
      sessionStorage.removeItem(PENDING_CAPTURE_KEY);
    } catch {
      props.onNotice("待保存的摘录无法恢复，请回到正文重新选择。");
      try {
        sessionStorage.removeItem(PENDING_CAPTURE_KEY);
      } catch {
        /* Storage access can itself be unavailable. */
      }
    }
  }, [service, active, props.book.id]);
  if (!active) return null;
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
      {selectionError && !capture && (
        <span className="reader-selection-capture ui-btn ui-btn-lg ui-btn-default" role="status">
          {selectionError}
        </span>
      )}
      {noteLocator && !capture && (
        <div
          className="reader-selection-capture reader-selection-actions"
          role="group"
          aria-label="选段操作"
        >
          <button
            type="button"
            className="ui-btn ui-btn-lg ui-btn-default"
            onPointerDown={(event) => event.preventDefault()}
            onClick={() => {
              props.onAddAnnotation(noteLocator);
              setNoteLocator(null);
              setSelection(null);
            }}
          >
            <MessageSquarePlus className="reader-icon" />
            写笔记
          </button>
          {selection && (
            <button
              type="button"
              className="ui-btn ui-btn-lg ui-btn-primary"
              onPointerDown={(event) => event.preventDefault()}
              onClick={() => {
                if (!service) {
                  if (saving.current) return;
                  saving.current = true;
                  void persistReaderSnapshot(props.runtime, { durableLibrary: true, strict: true })
                    .then(() => {
                      sessionStorage.setItem(PENDING_CAPTURE_KEY, JSON.stringify(selection));
                      window.location.assign(
                        selection.document.route ??
                          `/reader?book=${encodeURIComponent(props.book.id)}`,
                      );
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
        </div>
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
