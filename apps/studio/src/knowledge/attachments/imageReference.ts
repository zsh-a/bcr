import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import type { Root, RootContent, Image, ImageReference, Definition } from "mdast";
import { attachmentId, attachmentUrl, type AttachmentReference } from "./attachmentModel";

const parser = unified().use(remarkParse).use(remarkGfm);
/** Edit a single reference; bytes, other occurrences and shared definitions stay unchanged. */
export function imageReferenceMarkdown(
  body: string,
  ref: AttachmentReference,
  label: string,
  width?: number,
) {
  if (label.length > 1000 || /\p{Cc}/u.test(label))
    throw new Error("图片说明最多 1000 个字符，不能包含换行");
  let image: Image | ImageReference | undefined;
  const definitions = new Map<string, Definition>();
  const visit = (node: Root | RootContent) => {
    if (node.type === "definition" && !definitions.has(node.identifier))
      definitions.set(node.identifier, node);
    if (
      (node.type === "image" || node.type === "imageReference") &&
      node.position?.start.offset === ref.from &&
      node.position?.end.offset === ref.to
    )
      image = node;
    if ("children" in node) for (const child of node.children) visit(child);
  };
  visit(parser.parse(body));
  if (!image) throw new Error("图片位置已变化，请重新打开设置");
  const found = image as Image | ImageReference;
  const definition =
    found.type === "imageReference" ? definitions.get(found.identifier) : undefined;
  const oldUrl = found.type === "image" ? found.url : definition?.url;
  if (!oldUrl || attachmentId(oldUrl) !== ref.id) throw new Error("图片引用已变化，请重新打开设置");
  const raw = body.slice(ref.from, ref.to);
  let depth = 1,
    end = 2;
  for (; end < raw.length; end++) {
    if (raw[end] === "\\") {
      end++;
      continue;
    }
    if (raw[end] === "[") depth++;
    if (raw[end] === "]" && --depth === 0) break;
  }
  const alt = label === ref.label ? raw.slice(2, end) : label.replace(/[\\[\]]/gu, "\\$&");
  const url = attachmentUrl(ref.id, width);
  if (found.type === "image") {
    const tail = raw.slice(end + 1),
      at = tail.indexOf(oldUrl);
    if (at < 0) throw new Error("无法更新图片目标，请使用源码编辑");
    return `![${alt}]` + tail.slice(0, at) + url + tail.slice(at + oldUrl.length);
  }
  const title = definition?.title?.replace(/[\\"]/gu, "\\$&");
  return `![${alt}](${url}${title ? ` "${title}"` : ""})`;
}
