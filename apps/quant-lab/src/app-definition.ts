import type { AppDefinition } from "@bcr/shell-contract";

/** Pure application identity, shared by routes and installation/build metadata. */
export const definition = {
  id: "quant",
  title: "Quant Lab",
  path: "/quant",
  description: "策略回测、参数比较与成交分析",
  section: "research",
  installation: {
    name: "BCR Quant Lab",
    shortName: "量化",
    entry: "../quant-lab/src/App.tsx",
    boot: "independent",
  },
} as const satisfies AppDefinition;
