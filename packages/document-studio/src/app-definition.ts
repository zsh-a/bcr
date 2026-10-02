import type { AppDefinition } from "@bcr/shell-contract";

/** Pure application identity, shared by routes and installation/build metadata. */
export const definition = {
  id: "documents",
  title: "Document Studio",
  path: "/documents",
  description: "提取文档内容、识别图片文字与跨应用交接",
  section: "experimental",
  installation: {
    name: "BCR Document Studio",
    shortName: "文档",
    entry: "../../packages/document-studio/src/App.tsx",
    boot: "workspace",
  },
} as const satisfies AppDefinition;
