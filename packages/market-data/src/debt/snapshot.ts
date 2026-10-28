import { bundledBisDebtSnapshot } from "./bis-snapshot";
import { bundledChinaDebtSnapshot } from "./china-snapshot";
import { bundledFiscalDebtSnapshot } from "./fiscal-snapshot";
import { parseDebtSnapshot } from "./validation";
import { mergeDebtSnapshots } from "./merge";
import { deriveDebtCreditGrowth } from "./derived";

const original = mergeDebtSnapshots(
  parseDebtSnapshot(bundledBisDebtSnapshot),
  parseDebtSnapshot(bundledChinaDebtSnapshot),
  parseDebtSnapshot(bundledFiscalDebtSnapshot),
);
/** Original source observations plus separately labelled local-currency growth calculations. */
export const bundledDebtSnapshot = parseDebtSnapshot({
  ...original,
  series: [...original.series, ...deriveDebtCreditGrowth(original)],
});
