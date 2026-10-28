import raw from "./china-snapshot.json?raw";
import type { CycleSnapshot } from "./model";

/** Published NBS monthly observations, available offline without embedding any executable HTML. */
export const bundledChinaSnapshot = JSON.parse(raw) as CycleSnapshot;
