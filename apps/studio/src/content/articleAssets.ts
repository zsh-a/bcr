import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import type { Root, RootContent, Definition } from "mdast";
import { attachmentId, attachmentReferences } from "../knowledge/attachments/attachmentModel";
import { parseVisualUrl } from "./links";
import type { ContentProject } from "./model";

const parser = unified().use(remarkParse).use(remarkGfm);
/** A portable article owns every image; web pages remain normal source links. */
export function assertArticleAssets(
  body: string,
  project: Pick<ContentProject, "id" | "visuals">,
  attachments: readonly { id: string }[],
) {
  const root = parser.parse(body),
    definitions = new Map<string, Definition>();
  function collect(node: Root | RootContent) {
    if (node.type === "definition" && !definitions.has(node.identifier))
      definitions.set(node.identifier, node);
    if ("children" in node) for (const child of node.children) collect(child);
  }
  collect(root);
  function walk(node: Root | RootContent) {
    if (
      node.type === "image" ||
      node.type === "imageReference" ||
      node.type === "link" ||
      node.type === "linkReference"
    ) {
      const url = "url" in node ? node.url : definitions.get(node.identifier)?.url;
      const image = node.type === "image" || node.type === "imageReference";
      if (url?.startsWith("content-visual:")) {
        const target = parseVisualUrl(url);
        if (!target || target.project !== project.id || !project.visuals[target.index])
          throw new Error("文稿引用的图表不属于当前项目或已缺失，请重新插入");
      } else if (image && (!url || !attachmentId(url))) {
        throw new Error("请先将文稿中的外部图片导入知识库附件，再生成发布快照或归档");
      }
    }
    if ("children" in node) for (const child of node.children) walk(child);
  }
  walk(root);
  if (attachmentReferences(body).some((r) => !attachments.some((a) => a.id === r.id)))
    throw new Error("文稿依赖的附件不完整");
}
