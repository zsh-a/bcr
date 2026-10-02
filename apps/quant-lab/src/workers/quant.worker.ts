import { marketResearchStore } from "@bcr/market-data/research/storage";
import { createArtifactIO, defineWorker } from "@bcr/runtime-worker";
import { jsgHandler } from "../execution/compute";
import { jsgGridHandler } from "../execution/grid-compute";
import { binanceHistoryHandler } from "../trend/execution/data";
import { trendChartHandler } from "../trend/execution/chart";
import { trendHandler } from "../trend/execution/compute";

const artifacts = createArtifactIO(marketResearchStore(), "opfs");

defineWorker({
  "quant.backtest.jsg": jsgHandler(artifacts),
  "quant.grid.jsg": jsgGridHandler(artifacts),
  "market.binance.history": binanceHistoryHandler(artifacts),
  "quant.chart.trend": trendChartHandler(artifacts),
  "quant.backtest.trend": trendHandler(artifacts),
});
