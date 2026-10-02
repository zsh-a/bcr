import type { AppDefinition } from "@bcr/shell-contract";

/** Pure application identity, shared by routes and installation/build metadata. */
export const definition = {
  id: "media",
  title: "Media Studio",
  path: "/media",
  description: "音视频转字幕，校对、翻译与导出",
  section: "tools",
  installation: {
    name: "BCR Media Studio",
    shortName: "媒体",
    entry: "../media-studio/src/App.tsx",
    boot: "independent",
  },
} as const satisfies AppDefinition;
