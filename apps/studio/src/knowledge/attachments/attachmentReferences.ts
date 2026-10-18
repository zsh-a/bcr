import type { Root, RootContent, Definition } from "mdast";

export interface AttachmentReference {
  id: string;
  image: boolean;
  label: string;
  from: number;
  to: number;
  width?: number;
}
export function attachmentId(url: string): string | null {
  const match = /^attachment:([a-zA-Z0-9][a-zA-Z0-9_-]{0,99})(?:\?width=([1-9]\d{1,3}))?$/u.exec(
    url,
  );
  if (match?.[2] && (+match[2] < 32 || +match[2] > 4096)) return null;
  return match?.[1] ?? null;
}
export function attachmentDisplayWidth(url: string) {
  return attachmentId(url) && url.includes("?width=") ? Number(url.split("?width=")[1]) : undefined;
}
export function attachmentUrl(id: string, width?: number) {
  if (width !== undefined && (!Number.isInteger(width) || width < 32 || width > 4096))
    throw new Error("显示宽度应为 32–4096 像素");
  return `attachment:${id}${width === undefined ? "" : `?width=${width}`}`;
}
function textOf(node: Root | RootContent): string {
  return "value" in node
    ? node.value
    : "children" in node
      ? node.children.map(textOf).join("")
      : "";
}
/** Called with the same tree and definitions used for links and visible character counts. */
export function attachmentReferencesFromTree(
  root: Root,
  definitions: ReadonlyMap<string, Definition>,
) {
  const refs: AttachmentReference[] = [];
  function walk(node: Root | RootContent) {
    if (
      node.type === "image" ||
      node.type === "link" ||
      node.type === "imageReference" ||
      node.type === "linkReference"
    ) {
      const url = "url" in node ? node.url : definitions.get(node.identifier)?.url;
      const id = url ? attachmentId(url) : null;
      const width = url ? attachmentDisplayWidth(url) : undefined;
      if (id)
        refs.push({
          id,
          image: node.type === "image" || node.type === "imageReference",
          label: "alt" in node ? (node.alt ?? "") : textOf(node),
          from: node.position!.start.offset!,
          to: node.position!.end.offset!,
          ...(width === undefined ? {} : { width }),
        });
    }
    if ("children" in node) for (const child of node.children) walk(child);
  }
  walk(root);
  return refs;
}
