import raw from "./china-activity-snapshot.json?raw";
import type { CycleSnapshot } from "./model";

/** Frozen observations extracted from original official NBS release tables; no requests on import. */
export const bundledChinaActivitySnapshot = JSON.parse(raw) as CycleSnapshot;
