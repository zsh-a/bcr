import { fetchBisDebtSnapshot } from "../packages/market-data/src/debt/bis";
import { fetchChinaDebtSnapshot } from "../packages/market-data/src/debt/china";
import { fetchFiscalDebtSnapshot } from "../packages/market-data/src/debt/fiscal";
import { parseDebtSnapshot } from "../packages/market-data/src/debt/validation";
import { mergeDebtSnapshots } from "../packages/market-data/src/debt/merge";

import { runSnapshotSync } from "./lib/snapshot-sync";

const providers = {
  bis: fetchBisDebtSnapshot,
  china: fetchChinaDebtSnapshot,
  fiscal: fetchFiscalDebtSnapshot,
};

const result = await runSnapshotSync({
  domain: "debt",
  providers,
  directory: new URL("../packages/market-data/src/debt/", import.meta.url),
  parse: parseDebtSnapshot,
  merge: mergeDebtSnapshots,
});
if (result.exitCode) process.exitCode = result.exitCode;
