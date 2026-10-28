import raw from "./oecd-confidence-snapshot.json?raw";
import type { CycleSnapshot } from "./model";

/** Frozen original OECD confidence observations; import causes no external requests. */
export const bundledConfidenceSnapshot = JSON.parse(raw) as CycleSnapshot;
