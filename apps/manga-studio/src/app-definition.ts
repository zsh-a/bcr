import type { AppDefinition } from "@bcr/shell-contract";

/** Pure application identity, shared by routes and installation/build metadata. */
export const definition = {
  id: "manga",
  title: "Manga Studio",
  displayTitle: "漫画翻译",
  path: "/manga",
  description: "漫画文字识别、翻译与排版审校",
  section: "experimental",
  installation: {
    name: "BCR Manga Studio",
    shortName: "漫画",
    entry: "../manga-studio/src/App.tsx",
    boot: "independent",
  },
} as const satisfies AppDefinition;
