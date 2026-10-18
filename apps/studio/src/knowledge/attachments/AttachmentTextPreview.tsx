import { useEffect, useRef, useState } from "react";
import { Button } from "@bcr/react";
import { Copy } from "lucide-react";
import type { KnowledgeAttachments } from "./attachments";
import type { KnowledgeAttachment } from "./attachmentModel";

export function AttachmentTextPreview({
  asset,
  storage,
}: {
  asset: KnowledgeAttachment;
  storage: KnowledgeAttachments;
}) {
  const [page, setPage] = useState(1);
  const [wrap, setWrap] = useState(true);
  const [retry, setRetry] = useState(0);
  const [result, setResult] = useState<{
    identity: string;
    page: number;
    pages: number;
    text: string;
    error: string;
  } | null>(null);
  const [copyStatus, setCopyStatus] = useState({ message: "", error: false });
  const generation = useRef(0);
  const identity = `${asset.id}:${asset.hash}`;
  useEffect(() => {
    const controller = new AbortController();
    generation.current++;
    setCopyStatus({ message: "", error: false });
    void storage.textPage(asset, page, controller.signal).then(
      (value) => {
        if (!controller.signal.aborted) setResult({ ...value, identity, error: "" });
      },
      (reason) => {
        if (!controller.signal.aborted)
          setResult({
            identity,
            page,
            pages: 1,
            text: "",
            error: reason instanceof Error ? reason.message : "无法读取附件文本",
          });
      },
    );
    return () => {
      controller.abort();
      generation.current++;
    };
  }, [asset, storage, identity, page, retry]);
  const shown = result?.identity === identity && result.page === page ? result : null;
  return (
    <section className="knowledge-text-preview" aria-label="附件文本预览" aria-busy={!shown}>
      <div className="knowledge-text-preview-tools">
        <label className="knowledge-checkbox">
          <input
            type="checkbox"
            checked={wrap}
            onChange={(event) => setWrap(event.target.checked)}
          />
          自动换行
        </label>
        <Button
          variant="ghost"
          size="sm"
          disabled={!shown || !!shown.error || !shown.text}
          onClick={async () => {
            const request = generation.current;
            try {
              await navigator.clipboard.writeText(shown?.text ?? "");
              if (request === generation.current)
                setCopyStatus({ message: "已复制当前页", error: false });
            } catch {
              if (request === generation.current)
                setCopyStatus({ message: "复制失败，请选中正文后复制。", error: true });
            }
          }}
        >
          <Copy size={15} />
          复制当前页
        </Button>
      </div>
      {!shown ? (
        <p role="status">正在读取附件文本…</p>
      ) : shown.error ? (
        <div>
          <p role="alert" className="knowledge-attachment-error">
            {shown.error}
          </p>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setResult(null);
              setRetry((value) => value + 1);
            }}
          >
            重新读取
          </Button>
        </div>
      ) : (
        <>
          {shown.text ? (
            <pre tabIndex={0} aria-label="附件正文" data-wrap={wrap}>
              <code>{shown.text}</code>
            </pre>
          ) : (
            <p className="knowledge-file-placeholder">文件为空。</p>
          )}
          <div className="knowledge-text-preview-pagination">
            <Button
              variant="ghost"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage((value) => value - 1)}
            >
              上一页
            </Button>
            <span>
              第 {page} / {shown.pages} 页
            </span>
            <Button
              variant="ghost"
              size="sm"
              disabled={page >= shown.pages}
              onClick={() => setPage((value) => value + 1)}
            >
              下一页
            </Button>
          </div>
          {shown.pages > 1 && (
            <p className="knowledge-small">
              每页约 48 KB，复制仅包含当前页；下载可获取完整原文件。
            </p>
          )}
        </>
      )}
      {copyStatus.message && (
        <p role={copyStatus.error ? "alert" : "status"}>{copyStatus.message}</p>
      )}
    </section>
  );
}
