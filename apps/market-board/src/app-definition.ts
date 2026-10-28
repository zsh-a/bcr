import type { AppDefinition } from "@bcr/shell-contract";

/** Pure application identity, shared by routes and installation/build metadata. */
export const definition = {
  id: "markets",
  title: "Market",
  displayTitle: "市场行情",
  path: "/markets",
  description: "全球宏观、周期与债务、历史事件及行情研究",
  section: "research",
  installation: {
    name: "BCR Market Atlas",
    shortName: "市场",
    entry: "../market-board/src/App.tsx",
    boot: "independent",
  },
} as const satisfies AppDefinition;
