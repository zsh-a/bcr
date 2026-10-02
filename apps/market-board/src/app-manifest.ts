import { definition } from "./app-definition";
import { Globe2 } from "lucide-react";
import type { AppManifest } from "@bcr/shell-contract";

/**
 * Market Atlas — multi-market board.
 *
 * Reads live quotes through `@bcr/market-data` and degrades to cached and demo
 * snapshots when the network is unavailable, so it is the one slice that is not
 * purely on-device.
 */
export const manifest = {
  ...definition,
  icon: Globe2,
  load: () => import("./App"),
  validateSearch: (search) => ({
    view:
      typeof search["view"] === "string" &&
      ["overview", "sectors", "breadth", "watchlist"].includes(search["view"])
        ? search["view"]
        : undefined,
    snapshot:
      typeof search["snapshot"] === "string" && /^[a-f0-9]{64}$/u.test(search["snapshot"])
        ? search["snapshot"]
        : undefined,
    date:
      typeof search["date"] === "string" && /^\d{4}-\d{2}-\d{2}$/u.test(search["date"])
        ? search["date"]
        : undefined,
    instrument: typeof search["instrument"] === "string" ? search["instrument"] : undefined,
  }),
} as const satisfies AppManifest;
