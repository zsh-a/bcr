import { AttachmentTextPreview } from "./AttachmentTextPreview";
import type { KnowledgeAttachment } from "./attachmentModel";
import type { KnowledgeAttachments } from "./attachments";

export function AttachmentDocumentPreview({
  asset,
  storage,
}: {
  asset: KnowledgeAttachment;
  storage: KnowledgeAttachments;
}) {
  return (
    <details className="knowledge-document-file-preview" open>
      <summary>
        <ChevronDown size={15} aria-hidden="true" />
        <span>文件内容</span>
        <small>只读预览</small>
      </summary>
      <AttachmentTextPreview key={`${asset.id}:${asset.hash}`} asset={asset} storage={storage} />
    </details>
  );
}
import { ChevronDown } from "lucide-react";
