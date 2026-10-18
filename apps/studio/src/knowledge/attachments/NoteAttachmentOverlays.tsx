import { ContextMenu, useNavigation } from "@bcr/react";
import {
  Download,
  Eye,
  Replace,
  Trash2,
  SlidersHorizontal,
  CornerDownLeft,
  CornerDownRight,
} from "lucide-react";
import { useState, type RefObject } from "react";
import { flushSync } from "react-dom";
import { publishDocumentHandoff } from "@bcr/document-core";
import type { MarkdownEditorHandle } from "../editor/MarkdownEditor";
import type { KnowledgeStore } from "../session/store";
import { attachmentPath } from "./attachmentModel";
import { AttachmentDialog, downloadAttachment } from "./AttachmentView";
import { canReadAttachmentText } from "./attachmentText";
import type { useNoteAttachments } from "./useNoteAttachments";
import { ImageSettingsDialog, type ImageSettingsTarget } from "./ImageSettingsDialog";

export function NoteAttachmentOverlays({
  attachments,
  source,
  store,
  flushForNavigation,
  locked,
  initialError,
  setView,
}: {
  attachments: ReturnType<typeof useNoteAttachments>;
  source: RefObject<MarkdownEditorHandle | null>;
  store: KnowledgeStore;
  flushForNavigation: () => Promise<void>;
  locked: boolean;
  initialError: string;
  setView: (view: "edit" | "source" | "read") => void;
}) {
  const navigation = useNavigation();
  const [imageSettings, setImageSettings] = useState<ImageSettingsTarget | null>(null);
  const {
    setAttachmentStatus,
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
  } = attachments;
  return (
    <>
      {imageSettings && (
        <ImageSettingsDialog
          target={imageSettings}
          source={source}
          disabled={locked || !!initialError}
          onClose={() => setImageSettings(null)}
        />
      )}
      {openedAsset && (
        <AttachmentDialog
          key={openedAsset.id}
          asset={openedAsset}
          storage={store.attachments}
          onClose={() => setOpenedAttachment(null)}
          text={attachmentText}
          ocrLanguage={ocrLanguage}
          onOcrLanguageChange={setOcrLanguage}
          onReadText={
            canReadAttachmentText(openedAsset) ? () => void extractAttachmentText() : undefined
          }
          onNextText={
            textPage && (textPage.nextOffset !== null || textPage.nextPage !== null)
              ? () => void extractAttachmentText(true)
              : undefined
          }
          onReader={
            openedAsset.mime === "application/pdf" ||
            /\.(?:epub|docx|txt|md|markdown|html|fb2)$/iu.test(openedAsset.name)
              ? () =>
                  void (async () => {
                    await flushForNavigation();
                    const blob = await store.attachments.require(openedAsset);
                    const format = (await import("@bcr/document-core")).formatForName(
                      openedAsset.name,
                      openedAsset.mime,
                    );
                    const id = publishDocumentHandoff({
                      jobId: `knowledge-${openedAsset.id}`,
                      target: "reader",
                      name: openedAsset.name,
                      format,
                      size: openedAsset.size,
                      file: new File([blob], openedAsset.name, { type: openedAsset.mime }),
                      sourceRef: {
                        id: attachmentPath(openedAsset.hash),
                        hash: openedAsset.hash,
                        storage: "opfs",
                        type: "file/document",
                        format: openedAsset.mime,
                      },
                    });
                    navigation.navigate(`/reader?document=${encodeURIComponent(id)}`);
                  })().catch((reason) =>
                    setAttachmentStatus({ message: String(reason), busy: false, error: true }),
                  )
              : undefined
          }
        />
      )}
      {attachmentMenu && (
        <ContextMenu
          label="附件操作"
          title={store.getSnapshot().attachments?.[attachmentMenu.ref.id]?.name ?? "附件"}
          x={attachmentMenu.x}
          y={attachmentMenu.y}
          trigger={attachmentMenu.trigger}
          onClose={() => setAttachmentMenu(null)}
          actions={[
            ...(attachmentMenu.ref.image
              ? [
                  {
                    id: "image-settings",
                    label: "图片设置",
                    icon: <SlidersHorizontal size={15} />,
                    disabled: locked || !!initialError,
                    run: () => {
                      setView("edit");
                      setImageSettings(attachmentMenu);
                    },
                  },
                  ...([true, false] as const).map((before) => ({
                    id: before ? "paragraph-before" : "paragraph-after",
                    label: before ? "在图片前插入段落" : "在图片后插入段落",
                    icon: before ? <CornerDownLeft size={15} /> : <CornerDownRight size={15} />,
                    disabled: locked || !!initialError,
                    run: () => {
                      // Focus must land in a visible editor before the next native input event.
                      flushSync(() => setView("edit"));
                      const at = before ? attachmentMenu.ref.from : attachmentMenu.ref.to;
                      const editor = source.current;
                      if (editor?.replaceRange(at, at, "\n\n", "", attachmentMenu.document))
                        editor.reveal(at + (before ? 0 : 2));
                      else
                        setAttachmentStatus({
                          message: "正文已变化，请重新选择图片",
                          busy: false,
                          error: true,
                        });
                    },
                  })),
                ]
              : []),
            {
              id: "open",
              label: "查看附件",
              icon: <Eye size={15} />,
              run: () => openAttachment(attachmentMenu.ref.id),
            },
            {
              id: "download",
              label: "下载原文件",
              icon: <Download size={15} />,
              run: () => {
                const asset = store.getSnapshot().attachments?.[attachmentMenu.ref.id];
                if (asset)
                  void store.attachments
                    .require(asset)
                    .then((blob) => downloadAttachment(blob, asset.name))
                    .catch((reason) =>
                      setAttachmentStatus({ message: String(reason), busy: false, error: true }),
                    );
              },
            },
            {
              id: "replace",
              label: "替换附件",
              icon: <Replace size={15} />,
              disabled: locked || !!initialError,
              separated: true,
              run: () => {
                setView("edit");
                source.current?.pickAttachment(attachmentMenu.ref.image, {
                  from: attachmentMenu.ref.from,
                  to: attachmentMenu.ref.to,
                  expected: attachmentMenu.expected,
                });
              },
            },
            {
              id: "remove",
              label: "移除当前引用",
              icon: <Trash2 size={15} />,
              disabled: locked || !!initialError,
              danger: true,
              run: () => {
                if (
                  !source.current?.replaceRange(
                    attachmentMenu.ref.from,
                    attachmentMenu.ref.to,
                    "",
                    attachmentMenu.expected,
                  )
                )
                  setAttachmentStatus({
                    message: "正文已变化，请重新选择附件",
                    busy: false,
                    error: true,
                  });
              },
            },
          ]}
        />
      )}
    </>
  );
}
