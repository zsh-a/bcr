import raw from "./oecd-snapshot.json?raw";
import type { CycleSnapshot } from "./model";

/** Frozen original OECD observations; importing the browser resource makes no network request. */
export const bundledOecdSnapshot = JSON.parse(raw) as CycleSnapshot;
