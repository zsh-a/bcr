import { createArtifactIO, defineWorker } from "@bcr/runtime-worker";
import { marketResearchStore } from "@bcr/market-data/research/storage";
import { jsgHandler } from "../jsg/compute";
import { jsgGridHandler } from "../jsg/grid-compute";

const artifacts = createArtifactIO(marketResearchStore(), "opfs");

defineWorker({
  "quant.backtest.jsg": jsgHandler(artifacts),
  "quant.grid.jsg": jsgGridHandler(artifacts),
});
