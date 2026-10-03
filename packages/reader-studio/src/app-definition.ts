import type { AppDefinition } from "@bcr/shell-contract";

/** Pure application identity, shared by routes and installation/build metadata. */
export const definition = {
  id: "reader",
  title: "Reader Studio",
  displayTitle: "阅读器",
  path: "/reader",
  description: "阅读书籍与文档，整理书签和笔记",
  section: "reading",
  installation: {
    name: "BCR Reader",
    shortName: "Reader",
    entry: "src/reader-main.tsx",
    boot: "reader",
  },
} as const satisfies AppDefinition;
