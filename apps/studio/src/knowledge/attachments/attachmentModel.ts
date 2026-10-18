import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import type { Root, RootContent } from "mdast";
import { attachmentId, attachmentUrl } from "./attachmentReferences";
import { markdownFacts } from "../notes/markdownAnalysis";
export {
  attachmentId,
  attachmentUrl,
  attachmentDisplayWidth,
  type AttachmentReference,
} from "./attachmentReferences";

export const ATTACHMENT_FILE_LIMIT = 128 * 1024 * 1024;
export const ATTACHMENT_TRANSFER_LIMIT = 512 * 1024 * 1024;
export const ATTACHMENT_PREFIX = "knowledge/attachments/";
export interface KnowledgeAttachment {
  id: string;
  hash: string;
  name: string;
  mime: string;
  size: number;
  createdAt: number;
  width?: number;
  height?: number;
}
export type AttachmentRecords = Record<string, KnowledgeAttachment>;
const identifier = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$/u;
const digest = /^[a-f0-9]{64}$/u;
export const attachmentPath = (hash: string) => {
  if (!digest.test(hash)) throw new Error("附件内容摘要无效");
  return `${ATTACHMENT_PREFIX}${hash}`;
};
export const attachmentArchivePath = (hash: string) => `${attachmentPath(hash)}.bin`;
export const isPreviewImage = (mime: string) => /^image\/(png|jpeg|webp|gif|avif|bmp)$/u.test(mime);
export function decodeAttachments(value: unknown): AttachmentRecords | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("附件清单无效");
  const entries = Object.entries(value);
  if (entries.length > 10_000) throw new Error("附件数量超过限制");
  const result: AttachmentRecords = {};
  const sizes = new Map<string, number>();
  for (const [id, raw] of entries) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("附件记录无效");
    const a = raw as Record<string, unknown>;
    if (
      !identifier.test(id) ||
      ["__proto__", "constructor", "prototype"].includes(id) ||
      a.id !== id ||
      typeof a.hash !== "string" ||
      !digest.test(a.hash) ||
      typeof a.name !== "string" ||
      !a.name.trim() ||
      a.name.length > 500 ||
      /\p{Cc}/u.test(a.name) ||
      typeof a.mime !== "string" ||
      !/^[a-z\d!#$&^_.+-]+\/[a-z\d!#$&^_.+-]+$/u.test(a.mime) ||
      typeof a.size !== "number" ||
      !Number.isSafeInteger(a.size) ||
      a.size < 0 ||
      a.size > ATTACHMENT_FILE_LIMIT ||
      typeof a.createdAt !== "number" ||
      !Number.isSafeInteger(a.createdAt) ||
      a.createdAt < 0
    )
      throw new Error("附件身份、类型或大小无效");
    if (sizes.has(a.hash) && sizes.get(a.hash) !== a.size)
      throw new Error("相同内容的附件大小不一致");
    sizes.set(a.hash, a.size);
    const size: { width?: number; height?: number } = {};
    for (const field of ["width", "height"] as const) {
      if (a[field] === undefined) continue;
      if (
        typeof a[field] !== "number" ||
        !Number.isSafeInteger(a[field]) ||
        a[field] <= 0 ||
        a[field] > 100_000
      )
        throw new Error("图片尺寸无效");
      size[field] = a[field];
    }
    result[id] = {
      id,
      hash: a.hash,
      name: a.name,
      mime: a.mime,
      size: a.size,
      createdAt: a.createdAt,
      ...size,
    };
  }
  return entries.length ? result : undefined;
}
/** Asset metadata is immutable; a colliding identity must never replace bytes silently. */
export function mergeAttachments(...sources: (AttachmentRecords | undefined)[]) {
  const records: AttachmentRecords = {};
  for (const source of sources)
    for (const asset of Object.values(source ?? {})) {
      const previous = records[asset.id];
      if (
        previous &&
        (previous.hash !== asset.hash ||
          previous.size !== asset.size ||
          previous.mime !== asset.mime)
      )
        throw new Error(`附件身份冲突：${asset.name}，未覆盖文件`);
      records[asset.id] ??= asset;
    }
  return Object.keys(records).length ? records : undefined;
}

const parser = unified().use(remarkParse).use(remarkGfm);
/** Shares one parse with headings, links and visible text statistics. */
export function attachmentReferences(body: string) {
  return markdownFacts(body).attachments;
}
export function rewriteAttachmentUrls(body: string, resolve: (id: string) => string) {
  return rewriteMarkdownUrls(body, (url) => {
    const id = attachmentId(url);
    return id ? resolve(id) : null;
  });
}
/** Rewrite used Markdown destinations while preserving prose, code and labels verbatim. */
export function rewriteMarkdownUrls(body: string, resolve: (url: string) => string | null) {
  const edits: { from: number; to: number; text: string }[] = [];
  const root = parser.parse(body);
  const used = new Set<string>();
  function referencesIn(node: Root | RootContent) {
    if (node.type === "imageReference" || node.type === "linkReference") used.add(node.identifier);
    if ("children" in node) for (const child of node.children) referencesIn(child);
  }
  referencesIn(root);
  const definitions = new Set<string>();
  function walk(node: Root | RootContent) {
    if (node.type === "image" || node.type === "link" || node.type === "definition") {
      if (node.type === "definition") {
        if (definitions.has(node.identifier)) return;
        definitions.add(node.identifier);
        if (!used.has(node.identifier)) return;
      }
      const replacement = resolve(node.url);
      if (replacement !== null && replacement !== node.url) {
        const from = node.position!.start.offset!,
          to = node.position!.end.offset!;
        const fragment = body.slice(from, to);
        if (fragment.startsWith("<")) {
          edits.push({ from, to, text: `[${node.url}](${replacement})` });
          return;
        }
        // A destination follows the closing label, before any optional title.
        let depth = 0,
          end = 0;
        for (let index = node.type === "image" ? 1 : 0; index < fragment.length; index++) {
          if (fragment[index] === "\\") {
            index++;
            continue;
          }
          if (fragment[index] === "[") depth++;
          if (fragment[index] === "]" && --depth === 0) {
            end = index;
            break;
          }
        }
        const start = end + 2;
        const at = fragment.indexOf(node.url, start);
        if (at < start) throw new Error("Markdown 链接无法导出");
        edits.push({ from: from + at, to: from + at + node.url.length, text: replacement });
      }
    }
    if ("children" in node) for (const child of node.children) walk(child);
  }
  walk(root);
  for (const edit of edits.sort((a, b) => b.from - a.from))
    body = body.slice(0, edit.from) + edit.text + body.slice(edit.to);
  return body;
}
export function attachmentMarkdown(asset: KnowledgeAttachment, name = asset.name) {
  const label = name.replace(/[\\[\]]/gu, "\\$&").replace(/[\r\n]/gu, " ");
  return `${isPreviewImage(asset.mime) ? "!" : ""}[${label}](${attachmentUrl(asset.id)})`;
}
