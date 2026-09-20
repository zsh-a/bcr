import { Globe2 } from "lucide-react";
import type { AppManifest } from "@bcr/shell-contract";

/**
 * Market Atlas — multi-market board.
 *
 * Reads live quotes through `@bcr/market-data` and degrades to cached and demo
 * snapshots when the network is unavailable, so it is the one slice that is not
 * purely on-device.
 */
export const manifest: AppManifest = {
  id: "markets",
  title: "Market Atlas",
  path: "/markets",
  icon: Globe2,
  description: "全球市场脉搏 · 5K+ A 股广度 / 板块热图 / 排行 · 实时行情，离线回退缓存与演示数据",
  section: "compute",
  load: () => import("./App"),
  validateSearch: (search) => ({
    instrument: typeof search["instrument"] === "string" ? search["instrument"] : undefined,
  }),
};
