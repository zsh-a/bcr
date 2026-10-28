import raw from "./bis-signals-snapshot.json?raw";
import type { CycleSnapshot } from "./model";

/** Original official BIS observations; loading this frozen browser resource does not fetch data. */
export const bundledBisSignalsSnapshot = JSON.parse(raw) as CycleSnapshot;
