import { ChartCandlestick } from "lucide-react";
import type { AppManifest } from "@bcr/shell-contract";

/** Quant Lab — local strategy research over columnar market data. */
export const manifest = {
  id: "quant",
  title: "Quant Lab",
  path: "/quant",
  icon: ChartCandlestick,
  description: "策略回测、参数比较与成交分析",
  section: "research",
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
