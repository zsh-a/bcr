import type { AppDefinition } from "@bcr/shell-contract";

/** Pure application identity, shared by routes and installation/build metadata. */
export const definition = {
  id: "markets",
  title: "Market",
  path: "/markets",
  description: "行情、行业表现、历史宽度与自选研究",
  section: "research",
  installation: {
    name: "BCR Market Atlas",
    shortName: "市场",
    entry: "../market-board/src/App.tsx",
    boot: "independent",
  },
} as const satisfies AppDefinition;
