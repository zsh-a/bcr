import { bundledOecdSnapshot } from "./oecd-snapshot";
import { bundledChinaSnapshot } from "./china-snapshot";
import { bundledChinaActivitySnapshot } from "./china-activity-snapshot";
import { bundledFredSnapshot } from "./fred-snapshot";
import { bundledBisSignalsSnapshot } from "./bis-signals-snapshot";
import { bundledConfidenceSnapshot } from "./oecd-confidence-snapshot";
import { bundledUsSignalsSnapshot } from "./us-signals-snapshot";
import { parseCycleSnapshot } from "./validation";
import { mergeCycleSnapshots } from "./merge";
import { deriveCycleSignals } from "./signals";

/** Static project resources only. No network or browser storage access. */
const original = mergeCycleSnapshots(
  parseCycleSnapshot(bundledOecdSnapshot),
  parseCycleSnapshot(bundledChinaSnapshot),
  parseCycleSnapshot(bundledChinaActivitySnapshot),
  parseCycleSnapshot(bundledFredSnapshot),
  parseCycleSnapshot(bundledBisSignalsSnapshot),
  parseCycleSnapshot(bundledUsSignalsSnapshot),
  parseCycleSnapshot(bundledConfidenceSnapshot),
);
export const bundledCycleSnapshot = parseCycleSnapshot({
  ...original,
  series: [...original.series, ...deriveCycleSignals(original)],
});
