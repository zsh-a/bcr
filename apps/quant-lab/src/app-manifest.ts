import type { AppManifest } from "@bcr/shell-contract";
import { ChartCandlestick } from "lucide-react";
import { definition } from "./app-definition";

/** Quant Lab — local strategy research over columnar market data. */
export const manifest = {
  ...definition,
  icon: ChartCandlestick,
  load: () => import("./App"),
  validateSearch: (search) => ({
    snapshot:
      typeof search["snapshot"] === "string" && /^[a-f0-9]{64}$/u.test(search["snapshot"])
        ? search["snapshot"]
        : undefined,
    date:
      typeof search["date"] === "string" && /^\d{4}-\d{2}-\d{2}$/u.test(search["date"])
        ? search["date"]
        : undefined,
  }),
} as const satisfies AppManifest;
