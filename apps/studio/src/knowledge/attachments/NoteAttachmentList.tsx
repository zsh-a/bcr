import { Button, IconButton } from "@bcr/react";
import { Ellipsis, FileText, Paperclip } from "lucide-react";
import type { AttachmentReference, KnowledgeAttachment } from "./attachmentModel";
import { attachmentSize } from "./AttachmentView";

export function NoteAttachmentList({
  refs,
  assets,
  disabled,
  onAdd,
  onOpen,
  onMenu,
}: {
  refs: readonly AttachmentReference[];
  assets: Record<string, KnowledgeAttachment>;
  disabled: boolean;
  onAdd: () => void;
  onOpen: (id: string) => void;
  onMenu: (ref: AttachmentReference, x: number, y: number) => void;
}) {
  const unique = [...new Map(refs.map((ref) => [ref.id, ref])).values()];
  return (
    <div className="knowledge-attachments-list">
      <Button
        className="knowledge-attachments-add"
        variant="default"
        size="sm"
        disabled={disabled}
        onClick={onAdd}
      >
        <Paperclip size={15} />
        添加附件
      </Button>
      {unique.map((ref) => {
        const asset = assets[ref.id];
        const name = ref.label || asset?.name || "附件缺失";
        return (
          <div className="knowledge-attachment-row" key={ref.id}>
            <button
              type="button"
              className="knowledge-attachment-open"
              title={name}
              aria-label={name}
              onClick={() => onOpen(ref.id)}
            >
              <FileText size={18} aria-hidden="true" />
              <span className="knowledge-attachment-copy">
                <span>{name}</span>
                <small>
                  {asset
                    ? `${asset.name.split(".").at(-1)?.toUpperCase() || "文件"} · ${attachmentSize(asset.size)}`
                    : "需要同步或恢复"}
                </small>
              </span>
            </button>
            <IconButton
              label={`附件操作：${name}`}
              title="更多附件操作"
              size="sm"
              onClick={(event) => {
                const box = event.currentTarget.getBoundingClientRect();
                onMenu(ref, box.left + box.width / 2, box.top + box.height / 2);
              }}
            >
              <Ellipsis size={16} />
            </IconButton>
          </div>
        );
      })}
      {!unique.length && (
        <p className="knowledge-context-empty">粘贴截图或拖入文件，附件会随笔记保存。</p>
      )}
    </div>
  );
}
