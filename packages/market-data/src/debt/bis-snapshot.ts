import raw from "./bis-snapshot.json?raw";
import type { DebtSnapshot } from "./model";

/** Original official BIS quarterly observations, bundled independently of the ingestion adapter. */
export const bundledBisDebtSnapshot = JSON.parse(raw) as DebtSnapshot;
