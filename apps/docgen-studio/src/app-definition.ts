import type { AppDefinition } from "@bcr/shell-contract";

/** Pure application identity, shared by routes and installation/build metadata. */
export const definition = {
  id: "docgen",
  title: "DocGen Lab",
  displayTitle: "票据生成",
  path: "/docgen",
  description: "生成虚构账单，用于识别与阅读流程验证",
  section: "developer",
  installation: {
    name: "BCR DocGen Lab",
    shortName: "文档生成",
    entry: "../docgen-studio/src/App.tsx",
    boot: "independent",
  },
} as const satisfies AppDefinition;
