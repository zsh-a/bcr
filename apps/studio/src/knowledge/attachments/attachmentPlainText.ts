import type { BinaryStore } from "@bcr/storage-opfs";
import { attachmentPath, isPreviewImage, type KnowledgeAttachment } from "./attachmentModel";

export const TEXT_PREVIEW_PAGE_BYTES = 48 * 1024;

/** HTML and SVG can be inspected as text; they are never mounted as documents. */
export function isPlainTextAttachment(asset: KnowledgeAttachment) {
  if (
    isPreviewImage(asset.mime) ||
    asset.mime === "application/pdf" ||
    asset.mime.startsWith("audio/") ||
    asset.mime.startsWith("video/")
  )
    return false;
  return (
    asset.mime.startsWith("text/") ||
    [
      "application/json",
      "application/ld+json",
      "application/yaml",
      "application/x-yaml",
      "application/toml",
      "application/xml",
      "application/xhtml+xml",
      "image/svg+xml",
    ].includes(asset.mime) ||
    /\.(?:txt|md|markdown|csv|json|ya?ml|toml|log|js|mjs|ts|tsx|jsx|py|rs|css|html?|xml|svg|ini|conf|sh)$/iu.test(
      asset.name,
    )
  );
}

/** Read one UTF-8 window, including at most four boundary bytes, without loading the file. */
export async function readPlainTextPage(
  binary: BinaryStore,
  asset: KnowledgeAttachment,
  page: number,
  signal?: AbortSignal,
) {
  if (!isPlainTextAttachment(asset)) throw new Error("该附件不支持直接文本预览");
  signal?.throwIfAborted();
  const pages = Math.max(1, Math.ceil(asset.size / TEXT_PREVIEW_PAGE_BYTES));
  if (!Number.isSafeInteger(page) || page < 1 || page > pages) throw new Error("附件页码超出范围");
  const path = `artifacts/${attachmentPath(asset.hash)}`;
  const size = await binary.size(path);
  if (size === undefined) throw new Error(`缺少附件：${asset.name}。请同步或从完整备份恢复。`);
  if (size !== asset.size) throw new Error(`${asset.name} 的文件长度不符`);
  signal?.throwIfAborted();
  const start = (page - 1) * TEXT_PREVIEW_PAGE_BYTES;
  const end = Math.min(page * TEXT_PREVIEW_PAGE_BYTES, size);
  const from = Math.max(0, start - 3),
    to = Math.min(size, end + 1);
  const bytes = await binary.readRange(path, from, to - from);
  signal?.throwIfAborted();
  if (bytes.length !== to - from) throw new Error("附件读取不完整，请重新同步或恢复");
  let left = start - from,
    right = end - from;
  while (left > 0 && (bytes[left]! & 0xc0) === 0x80) left--;
  if (end < size) while (right > 0 && (bytes[right]! & 0xc0) === 0x80) right--;
  return {
    text: new TextDecoder("utf-8", { ignoreBOM: page > 1 }).decode(bytes.subarray(left, right)),
    page,
    pages,
  };
}
