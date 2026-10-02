import { marketResearchStore } from "@bcr/market-data/research/storage";
import { createArtifactIO, defineWorker } from "@bcr/runtime-worker";
import { jsgHandler } from "../execution/compute";
import { jsgGridHandler } from "../execution/grid-compute";

const artifacts = createArtifactIO(marketResearchStore(), "opfs");

defineWorker({
  "quant.backtest.jsg": jsgHandler(artifacts),
  "quant.grid.jsg": jsgGridHandler(artifacts),
});
