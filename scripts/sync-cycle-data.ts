import { fetchOecdCycleSnapshot } from "../packages/market-data/src/cycle/oecd";
import { fetchChinaCycleSnapshot } from "../packages/market-data/src/cycle/china";
import { fetchChinaActivitySnapshot } from "../packages/market-data/src/cycle/china-activity";
import { fetchFredCycleSnapshot } from "../packages/market-data/src/cycle/fred";
import { fetchBisSignalsSnapshot } from "../packages/market-data/src/cycle/bis-signals";
import { fetchUsSignalsSnapshot } from "../packages/market-data/src/cycle/us-signals";
import { fetchConfidenceSnapshot } from "../packages/market-data/src/cycle/oecd-confidence";
import { parseCycleSnapshot } from "../packages/market-data/src/cycle/validation";
import { mergeCycleSnapshots } from "../packages/market-data/src/cycle/merge";

import { runSnapshotSync } from "./lib/snapshot-sync";

const providers = {
  oecd: fetchOecdCycleSnapshot,
  china: fetchChinaCycleSnapshot,
  "china-activity": fetchChinaActivitySnapshot,
  fred: fetchFredCycleSnapshot,
  "bis-signals": fetchBisSignalsSnapshot,
  "us-signals": fetchUsSignalsSnapshot,
  "oecd-confidence": fetchConfidenceSnapshot,
};

const result = await runSnapshotSync({
  domain: "cycle",
  providers,
  directory: new URL("../packages/market-data/src/cycle/", import.meta.url),
  parse: parseCycleSnapshot,
  merge: mergeCycleSnapshots,
});
if (result.exitCode) process.exitCode = result.exitCode;
