import { createArtifactIO, defineWorker } from "@bcr/runtime-worker";
import { OpfsStore } from "@bcr/storage-opfs";
import { jsgHandler } from "../jsg/compute";
import { jsgGridHandler } from "../jsg/grid-compute";

const artifacts = createArtifactIO(new OpfsStore("quant"), "opfs");

defineWorker({
  "quant.backtest.jsg": jsgHandler(artifacts),
  "quant.grid.jsg": jsgGridHandler(artifacts),
});
