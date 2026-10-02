import { useEffect, useState } from "react";
import { Button } from "@bcr/react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { KnowledgeAttachment } from "./attachmentModel";
import type { KnowledgeAttachments } from "./attachments";
import type { createReaderPdfPreview } from "@bcr/reader-studio/adapters";

type PdfSession = Awaited<ReturnType<typeof createReaderPdfPreview>>;
export function AttachmentPdfPreview({
  asset,
  storage,
}: {
  asset: KnowledgeAttachment;
  storage: KnowledgeAttachments;
}) {
  const [session, setSession] = useState<PdfSession | null>(null);
  const [page, setPage] = useState(1);
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    let opened: PdfSession | undefined;
    void (async () => {
      const blob = await storage.require(asset);
      controller.signal.throwIfAborted();
      const { createReaderPdfPreview } = await import("@bcr/reader-studio/adapters");
      opened = await createReaderPdfPreview(
        new File([blob], asset.name, { type: asset.mime }),
        asset.id,
        controller.signal,
      );
      if (controller.signal.aborted) opened.close();
      else setSession(opened);
    })().catch((reason) => {
      if (!controller.signal.aborted)
        setError(reason instanceof Error ? reason.message : String(reason));
    });
    return () => {
      controller.abort();
      opened?.close();
    };
  }, [asset, storage]);
  useEffect(() => {
    if (!session) return;
    const controller = new AbortController();
    let objectUrl = "";
    setUrl("");
    setError("");
    void session
      .render(page, controller.signal)
      .then((blob) => {
        if (controller.signal.aborted) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch((reason) => {
        if (!controller.signal.aborted)
          setError(reason instanceof Error ? reason.message : String(reason));
      });
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [session, page]);
  return (
    <div className="knowledge-pdf-preview">
      {error ? (
        <p role="alert" className="knowledge-attachment-error">
          {error}
        </p>
      ) : url ? (
        <img src={url} alt={`${asset.name} · 第 ${page} 页`} />
      ) : (
        <p role="status">正在载入 PDF…</p>
      )}
      {session && (
        <div className="knowledge-pdf-pagination" aria-label="PDF 分页">
          <Button
            variant="ghost"
            size="sm"
            aria-label="上一页"
            disabled={page === 1 || !url}
            onClick={() => setPage(page - 1)}
          >
            <ChevronLeft size={16} />
          </Button>
          <span>
            {page} / {session.pages}
          </span>
          <Button
            variant="ghost"
            size="sm"
            aria-label="下一页"
            disabled={page === session.pages || !url}
            onClick={() => setPage(page + 1)}
          >
            <ChevronRight size={16} />
          </Button>
        </div>
      )}
    </div>
  );
}
