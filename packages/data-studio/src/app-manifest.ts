import { definition } from "./app-definition";
import { Table2 } from "lucide-react";
import type { AppManifest } from "@bcr/shell-contract";

/** Data Studio — local tabular exploration over CSV / JSON / NDJSON. */
/** Operations this app contributes to the host compute worker. */
const DATA_COMPUTE = {
  backends: { wasm: [], js: ["data.parse.table"] },
} as const;

export const manifest = {
  ...definition,
  icon: Table2,
  load: () => import("./App"),
  validateSearch: (search) => ({
    query: typeof search["query"] === "string" ? search["query"] : undefined,
  }),
  compute: DATA_COMPUTE,
} as const satisfies AppManifest;
