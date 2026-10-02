import { useEffect, useRef, useState } from "react";
import type { KnowledgeStore } from "../session/store";
import type { NoteDraft } from "../editor/draft";
import type { AttachmentReference } from "./attachmentModel";
import { readAttachmentText } from "./attachmentText";

/** Preview, extraction, and context-menu state for the current note. */
export function useNoteAttachments(controller: NoteDraft, store: KnowledgeStore) {
  const [attachmentStatus, setAttachmentStatus] = useState({
    message: "",
    busy: false,
    error: false,
  });
  const [openedAttachment, setOpenedAttachment] = useState<string | null>(null);
  const [attachmentMenu, setAttachmentMenu] = useState<{
    ref: AttachmentReference;
    expected: string;
    x: number;
    y: number;
    trigger: HTMLElement;
  } | null>(null);
  const openedAsset = openedAttachment
    ? store.getSnapshot().attachments?.[openedAttachment]
    : undefined;
  const [attachmentText, setAttachmentText] = useState({
    body: "",
    busy: false,
    status: "",
    error: "",
  });
  const [textPage, setTextPage] = useState<Awaited<ReturnType<typeof readAttachmentText>> | null>(
    null,
  );
  const textController = useRef<AbortController | null>(null);
  const [ocrLanguage, setOcrLanguage] = useState<"en" | "ja">("en");
  useEffect(() => {
    setAttachmentText({ body: "", busy: false, status: "", error: "" });
    setTextPage(null);
    return () => textController.current?.abort();
  }, [openedAttachment, ocrLanguage]);
  async function extractAttachmentText(next = false) {
    if (!openedAsset || attachmentText.busy) return;
    textController.current?.abort();
    const controller = new AbortController();
    textController.current = controller;
    const page = next
      ? textPage?.nextOffset !== null
        ? (textPage?.page ?? 1)
        : (textPage?.nextPage ?? 1)
      : 1;
    const offset = next ? (textPage?.nextOffset ?? 0) : 0;
    setAttachmentText((previous) => ({
      ...previous,
      busy: true,
      error: "",
      status: openedAsset.mime.startsWith("image/")
        ? "正在运行本地 OCR，首次使用会加载识别模型…"
        : "正在读取附件文本…",
    }));
    try {
      const result = await readAttachmentText(store, openedAsset, {
        page,
        offset,
        ocr: true,
        language: ocrLanguage,
        signal: controller.signal,
      });
      controller.signal.throwIfAborted();
      setTextPage(result);
      setAttachmentText((previous) => ({
        body: next && offset ? previous.body + result.text : result.text,
        busy: false,
        error: "",
        status: `${result.label} · ${result.page} / ${result.totalPages}`,
      }));
    } catch (reason) {
      if (!controller.signal.aborted)
        setAttachmentText((previous) => ({
          ...previous,
          busy: false,
          error: reason instanceof Error ? reason.message : String(reason),
        }));
    }
  }
  const openAttachment = (id: string) => {
    if (!store.getSnapshot().attachments?.[id]) {
      setAttachmentStatus({ message: "附件记录缺失，请同步或恢复备份", busy: false, error: true });
      return;
    }
    setOpenedAttachment(id);
  };
  function menuAttachment(ref: AttachmentReference, x: number, y: number) {
    const target =
      document.elementFromPoint(x, y)?.closest<HTMLElement>("button") ?? document.activeElement;
    if (!(target instanceof HTMLElement)) return;
    setAttachmentMenu({
      ref,
      x,
      y,
      trigger: target,
      expected: controller.getSnapshot().note.body.slice(ref.from, ref.to),
    });
  }

  return {
    attachmentStatus,
    setAttachmentStatus,
    openedAttachment,
    setOpenedAttachment,
    attachmentMenu,
    setAttachmentMenu,
    openedAsset,
    attachmentText,
    textPage,
    ocrLanguage,
    setOcrLanguage,
    extractAttachmentText,
    openAttachment,
    menuAttachment,
  };
}
