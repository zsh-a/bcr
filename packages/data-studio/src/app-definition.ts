import type { AppDefinition } from "@bcr/shell-contract";

/** Pure application identity, shared by routes and installation/build metadata. */
export const definition = {
  id: "data",
  title: "Data Studio",
  displayTitle: "数据表格",
  path: "/data",
  description: "导入表格，浏览、搜索与导出数据",
  section: "tools",
  installation: {
    name: "BCR Data Studio",
    shortName: "数据",
    entry: "../../packages/data-studio/src/App.tsx",
    boot: "workspace",
  },
} as const satisfies AppDefinition;
