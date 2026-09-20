import { ChartCandlestick } from "lucide-react";
import type { AppManifest } from "@bcr/shell-contract";

/** Quant Lab — local strategy research over columnar market data. */
export const manifest = {
  id: "quant",
  title: "Quant Lab",
  path: "/quant",
  icon: ChartCandlestick,
  description: "本地策略研究 · OHLCV / SMA 信号 / 回测权益 / 成交分析",
  section: "compute",
  load: () => import("./App"),
  validateSearch: (search) => ({
    dataset: typeof search["dataset"] === "string" ? search["dataset"] : undefined,
  }),
} as const satisfies AppManifest;
